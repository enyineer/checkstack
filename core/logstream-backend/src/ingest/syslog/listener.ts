/**
 * RFC 5424 syslog listener over TCP (optionally TLS), enabled only when the
 * environment provides a port. Frames with {@link SyslogFramer} (octet-counting
 * or LF), resolves the source token from each message, and feeds resolved lines
 * into the ingest pipeline. Lines with no resolvable / invalid token are counted
 * and dropped.
 *
 * MULTI-POD: every pod binds its own socket on the same port inside its own
 * container (a load balancer fronts them); no cross-pod coordination. To avoid a
 * port clash between the default and a secondary (preview) instance sharing a
 * host, the listener binds only on the DEFAULT instance.
 */

import { z } from "zod";
import type { Logger, InstanceRuntime } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "../auth";
import type { StreamConfigResolver } from "../stream-config";
import type { IngestPipeline } from "../pipeline";
import {
  type IngestedLine,
  SyslogFramer,
  parseSyslog5424,
  syslogToIngestedLine,
} from "@checkstack/logstream-common";

/** Default cap on concurrent syslog TCP connections per pod. */
export const DEFAULT_SYSLOG_MAX_CONNECTIONS = 100;

/**
 * How long a per-connection token verdict is trusted before it is re-verified
 * against the shared cache. A long-lived syslog connection must NOT pin an old
 * verdict for its whole lifetime, or a revoked token keeps ingesting until the
 * client disconnects. 60s bounds that window; the re-check is cheap (it hits the
 * shared token cache, not the DB, for a warm token).
 */
export const SYSLOG_VERDICT_TTL_MS = 60_000;

export const SyslogEnvConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  hostname: z.string().default("0.0.0.0"),
  maxConnections: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_SYSLOG_MAX_CONNECTIONS),
});
export type SyslogEnvConfig = z.infer<typeof SyslogEnvConfigSchema>;

/**
 * Read the optional syslog listener config from the environment. Returns null
 * when `CHECKSTACK_LOGSTREAM_SYSLOG_PORT` is unset (listener disabled).
 */
export function readSyslogEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): SyslogEnvConfig | null {
  const port = env.CHECKSTACK_LOGSTREAM_SYSLOG_PORT;
  if (!port) return null;
  return SyslogEnvConfigSchema.parse({
    port,
    tlsCertPath: env.CHECKSTACK_LOGSTREAM_SYSLOG_TLS_CERT,
    tlsKeyPath: env.CHECKSTACK_LOGSTREAM_SYSLOG_TLS_KEY,
    hostname: env.CHECKSTACK_LOGSTREAM_SYSLOG_HOST,
    maxConnections: env.CHECKSTACK_LOGSTREAM_SYSLOG_MAX_CONNECTIONS,
  });
}

export type ConnectionVerdict =
  | { ok: false }
  | { ok: true; streamId: string; tokenId: string };

export interface ConnectionState {
  framer: SyslogFramer;
  /** One-entry token verdict cache (a connection usually carries one token). */
  cachedToken?: string;
  cachedVerdict?: ConnectionVerdict;
  /** Wall-clock ms when `cachedVerdict` was produced (for TTL re-verification). */
  verdictAtMs?: number;
}

/**
 * Resolve a token for a connection, reusing the cached verdict only while it is
 * for the SAME token AND younger than {@link SYSLOG_VERDICT_TTL_MS}. A different
 * token, or a stale verdict, forces a fresh {@link IngestAuthenticator.verify}
 * (which honors revoke via the shared cache). Extracted for unit testing without
 * a live socket.
 */
export async function verifyConnectionToken({
  state,
  token,
  auth,
  nowMs,
}: {
  state: ConnectionState;
  token: string;
  auth: IngestAuthenticator;
  nowMs: number;
}): Promise<ConnectionVerdict> {
  const fresh =
    state.verdictAtMs !== undefined &&
    nowMs - state.verdictAtMs < SYSLOG_VERDICT_TTL_MS;
  if (state.cachedToken === token && state.cachedVerdict && fresh) {
    return state.cachedVerdict;
  }
  const result = await auth.verify(token);
  const verdict: ConnectionVerdict = result.ok
    ? { ok: true, streamId: result.streamId, tokenId: result.tokenId }
    : { ok: false };
  state.cachedToken = token;
  state.cachedVerdict = verdict;
  state.verdictAtMs = nowMs;
  return verdict;
}

/**
 * Clear cached verdicts on a set of live connection states. Pure over the
 * given iterable so it is unit-testable without sockets.
 *
 * - `tokenIds` set: evict POSITIVE verdicts for exactly those tokens (revoke /
 *   stream delete) - the next frame re-verifies via {@link verifyConnectionToken},
 *   whose shared-cache read now sees the revocation.
 * - `negatives` true: evict NEGATIVE (`ok: false`) verdicts (a token was just
 *   minted) so a shipper retrying on an open connection re-verifies instead of
 *   waiting out the per-connection TTL.
 */
export function invalidateConnectionVerdicts({
  states,
  tokenIds,
  negatives = false,
}: {
  states: Iterable<ConnectionState>;
  tokenIds?: readonly string[];
  negatives?: boolean;
}): number {
  const ids = tokenIds ? new Set(tokenIds) : undefined;
  let evicted = 0;
  for (const state of states) {
    const verdict = state.cachedVerdict;
    if (!verdict) continue;
    const matchesPositive = verdict.ok && ids !== undefined && ids.has(verdict.tokenId);
    const matchesNegative = !verdict.ok && negatives;
    if (matchesPositive || matchesNegative) {
      state.cachedToken = undefined;
      state.cachedVerdict = undefined;
      state.verdictAtMs = undefined;
      evicted += 1;
    }
  }
  return evicted;
}

export interface SyslogListener {
  start(): void;
  stop(): void;
  /**
   * Evict cached per-connection verdicts (see {@link invalidateConnectionVerdicts}).
   * Called by the ingest area's `logstream.tokens.invalidated` consumer so a
   * revoked token stops ingesting on an already-open connection immediately.
   */
  invalidateVerdicts(args: {
    tokenIds?: readonly string[];
    negatives?: boolean;
  }): number;
}

export function createSyslogListener({
  config,
  auth,
  configResolver,
  pipeline,
  logger,
  instanceRuntime,
  now = () => new Date(),
}: {
  config: SyslogEnvConfig;
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  pipeline: IngestPipeline;
  logger: Logger;
  instanceRuntime: InstanceRuntime;
  now?: () => Date;
}): SyslogListener {
  let server: Bun.TCPSocketListener<ConnectionState> | null = null;
  let droppedNoToken = 0;
  let droppedUnparseable = 0;
  let activeConnections = 0;
  let rejectedConnections = 0;
  /** Live connection states, tracked so token invalidations can reach them. */
  const connectionStates = new Set<ConnectionState>();

  async function handleMessages(
    state: ConnectionState,
    messages: string[],
  ): Promise<void> {
    const byStream = new Map<
      string,
      { tokenId: string; config: Awaited<ReturnType<StreamConfigResolver["resolve"]>>; lines: IngestedLine[] }
    >();

    for (const raw of messages) {
      const parsed = parseSyslog5424(raw);
      if (!parsed) {
        droppedUnparseable += 1;
        continue;
      }
      if (!parsed.token) {
        droppedNoToken += 1;
        continue;
      }

      const verdict = await verifyConnectionToken({
        state,
        token: parsed.token,
        auth,
        nowMs: now().getTime(),
      });
      if (!verdict.ok) {
        droppedNoToken += 1;
        continue;
      }

      let entry = byStream.get(verdict.streamId);
      if (!entry) {
        const streamConfig = await configResolver.resolve(verdict.streamId);
        entry = { tokenId: verdict.tokenId, config: streamConfig, lines: [] };
        byStream.set(verdict.streamId, entry);
      }
      entry.lines.push(
        syslogToIngestedLine({ parsed, config: entry.config, now: now() }),
      );
    }

    for (const [streamId, entry] of byStream) {
      pipeline.ingest({
        streamId,
        lines: entry.lines,
        config: entry.config,
        tokenId: entry.tokenId,
        now: now(),
      });
    }
  }

  function start(): void {
    if (server) return;
    if (!instanceRuntime.isDefault) {
      logger.info(
        "logstream: syslog listener not started on a secondary instance (port isolation)",
      );
      return;
    }

    const tls =
      config.tlsCertPath && config.tlsKeyPath
        ? { cert: Bun.file(config.tlsCertPath), key: Bun.file(config.tlsKeyPath) }
        : undefined;

    server = Bun.listen<ConnectionState>({
      hostname: config.hostname,
      port: config.port,
      ...(tls ? { tls } : {}),
      socket: {
        open(socket) {
          if (activeConnections >= config.maxConnections) {
            rejectedConnections += 1;
            if (rejectedConnections === 1 || rejectedConnections % 100 === 0) {
              logger.warn(
                `logstream: syslog connection cap ${config.maxConnections} reached; rejecting (total rejected ${rejectedConnections})`,
              );
            }
            socket.end();
            return;
          }
          socket.data = { framer: new SyslogFramer() };
          connectionStates.add(socket.data);
          activeConnections += 1;
        },
        close(socket) {
          // Only decrement for a connection we actually counted (a rejected,
          // over-cap connection was never assigned `data` nor counted).
          if (socket.data && activeConnections > 0) {
            activeConnections -= 1;
            connectionStates.delete(socket.data);
          }
        },
        data(socket, chunk) {
          // A rejected (over-cap) connection has no data assigned; ignore any
          // bytes that raced in before the FIN.
          if (!socket.data) return;
          const { messages, reset } = socket.data.framer.push(
            new Uint8Array(chunk),
          );
          if (reset) {
            logger.warn("logstream: syslog framing reset (malformed frame)");
          }
          if (messages.length > 0) {
            void handleMessages(socket.data, messages).catch((error: unknown) =>
              logger.warn(`logstream: syslog processing failed: ${String(error)}`),
            );
          }
        },
        error(_socket, error) {
          logger.warn(`logstream: syslog socket error: ${String(error)}`);
        },
      },
    });

    logger.info(
      `logstream: syslog listener on ${config.hostname}:${config.port}` +
        (tls ? " (TLS)" : ""),
    );
  }

  function stop(): void {
    server?.stop(true);
    server = null;
    connectionStates.clear();
    if (droppedNoToken > 0 || droppedUnparseable > 0) {
      logger.debug(
        `logstream: syslog dropped ${droppedNoToken} untokened + ${droppedUnparseable} unparseable lines`,
      );
    }
  }

  function invalidateVerdicts(args: {
    tokenIds?: readonly string[];
    negatives?: boolean;
  }): number {
    const evicted = invalidateConnectionVerdicts({
      states: connectionStates,
      ...args,
    });
    if (evicted > 0) {
      logger.debug(
        `logstream: evicted ${evicted} syslog connection verdict(s) on token invalidation`,
      );
    }
    return evicted;
  }

  return { start, stop, invalidateVerdicts };
}
