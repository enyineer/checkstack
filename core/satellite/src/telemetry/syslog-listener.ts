/**
 * Agent-local RFC 5424 syslog listener over TCP (optionally TLS). Mirrors the
 * core logstream listener's framing + parsing (reusing the SHARED
 * {@link SyslogFramer} + {@link parseSyslog5424} + {@link syslogToIngestedLine}),
 * but instead of feeding a DB pipeline it FORWARDS resolved lines to the core
 * telemetry client, grouped by the `ckls_` token each message carried (in a
 * `[checkstack@... token="ckls_..."]` SD element or a `@ckls_...@ ` MSG prefix).
 *
 * The satellite does NOT verify the token (it has no token DB); the core
 * "logstream" capability handler verifies it and resolves the stream. Messages
 * with no resolvable token, or that don't parse, are counted and dropped.
 *
 * STATE & SCALE: the framer + per-connection buffers are pod-local transport
 * bookkeeping on a single agent process, never a queryable source of truth.
 */

import { z } from "zod";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SyslogFramer,
  parseSyslog5424,
  syslogToIngestedLine,
  type IngestedLine,
} from "@checkstack/logstream-common";
import {
  buildLogBatchItems,
  estimateLogItemBytes,
  LOGSTREAM_CAPABILITY_KIND,
  type TelemetryEnqueuer,
} from "./log-receiver";

/** Default cap on concurrent syslog TCP connections. */
export const DEFAULT_SYSLOG_MAX_CONNECTIONS = 100;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

export const SatelliteSyslogEnvConfigSchema = z.object({
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
export type SatelliteSyslogEnvConfig = z.infer<
  typeof SatelliteSyslogEnvConfigSchema
>;

/**
 * Read the satellite syslog listener config from the environment. Returns null
 * when `CHECKSTACK_SATELLITE_SYSLOG_PORT` is unset (listener disabled).
 */
export function readSatelliteSyslogEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): SatelliteSyslogEnvConfig | null {
  const port = env.CHECKSTACK_SATELLITE_SYSLOG_PORT;
  if (!port) return null;
  return SatelliteSyslogEnvConfigSchema.parse({
    port,
    tlsCertPath: env.CHECKSTACK_SATELLITE_SYSLOG_TLS_CERT,
    tlsKeyPath: env.CHECKSTACK_SATELLITE_SYSLOG_TLS_KEY,
    hostname: env.CHECKSTACK_SATELLITE_SYSLOG_HOST,
    maxConnections: env.CHECKSTACK_SATELLITE_SYSLOG_MAX_CONNECTIONS,
  });
}

export interface SyslogProcessResult {
  /** Resolved lines grouped by the raw `ckls_` token that authorized them. */
  byToken: Map<string, IngestedLine[]>;
  droppedNoToken: number;
  droppedUnparseable: number;
}

/**
 * Parse a batch of de-framed syslog messages into resolved lines grouped by
 * token. Pure over its inputs so it is unit-testable without a socket. Lines are
 * normalized with {@link DEFAULT_LOG_STREAM_CONFIG} (the agent has no per-stream
 * config; the core re-applies the stream's value map).
 */
export function processSyslogMessages({
  messages,
  now,
}: {
  messages: string[];
  now: Date;
}): SyslogProcessResult {
  const byToken = new Map<string, IngestedLine[]>();
  let droppedNoToken = 0;
  let droppedUnparseable = 0;

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
    let lines = byToken.get(parsed.token);
    if (!lines) {
      lines = [];
      byToken.set(parsed.token, lines);
    }
    lines.push(
      syslogToIngestedLine({ parsed, config: DEFAULT_LOG_STREAM_CONFIG, now }),
    );
  }

  return { byToken, droppedNoToken, droppedUnparseable };
}

/** Per-connection framing state. */
interface ConnectionState {
  framer: SyslogFramer;
}

export interface SyslogListener {
  start(): void;
  stop(): void;
}

/**
 * Create the agent syslog listener. Feeds resolved lines to `enqueue` (the
 * telemetry client) as "logstream" batch items keyed by token.
 */
export function createSatelliteSyslogListener({
  config,
  enqueue,
  logger,
  now = () => new Date(),
}: {
  config: SatelliteSyslogEnvConfig;
  enqueue: TelemetryEnqueuer;
  logger: Logger;
  now?: () => Date;
}): SyslogListener {
  let server: Bun.TCPSocketListener<ConnectionState> | null = null;
  let droppedNoToken = 0;
  let droppedUnparseable = 0;
  let activeConnections = 0;
  let rejectedConnections = 0;

  function handleMessages(messages: string[]): void {
    const result = processSyslogMessages({ messages, now: now() });
    droppedNoToken += result.droppedNoToken;
    droppedUnparseable += result.droppedUnparseable;
    for (const [streamToken, lines] of result.byToken) {
      enqueue.enqueue({
        kind: LOGSTREAM_CAPABILITY_KIND,
        items: buildLogBatchItems({ streamToken, lines }),
        estimateBytes: estimateLogItemBytes,
        // A buffer drop is charged to this stream token so the core surfaces the
        // loss on the right stream.
        groupKeyOf: () => streamToken,
      });
    }
  }

  function start(): void {
    if (server) return;
    const tls =
      config.tlsCertPath && config.tlsKeyPath
        ? {
            cert: Bun.file(config.tlsCertPath),
            key: Bun.file(config.tlsKeyPath),
          }
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
                `satellite: syslog connection cap ${config.maxConnections} reached; ` +
                  `rejecting (total rejected ${rejectedConnections})`,
              );
            }
            socket.end();
            return;
          }
          socket.data = { framer: new SyslogFramer() };
          activeConnections += 1;
        },
        close(socket) {
          if (socket.data && activeConnections > 0) activeConnections -= 1;
        },
        data(socket, chunk) {
          if (!socket.data) return;
          const { messages, reset } = socket.data.framer.push(
            new Uint8Array(chunk),
          );
          if (reset) {
            logger.warn("satellite: syslog framing reset (malformed frame)");
          }
          if (messages.length > 0) {
            try {
              handleMessages(messages);
            } catch (error) {
              logger.warn(
                `satellite: syslog processing failed: ${String(error)}`,
              );
            }
          }
        },
        error(_socket, error) {
          logger.warn(`satellite: syslog socket error: ${String(error)}`);
        },
      },
    });

    logger.info(
      `satellite: syslog listener on ${config.hostname}:${config.port}` +
        (tls ? " (TLS)" : ""),
    );
  }

  function stop(): void {
    server?.stop(true);
    server = null;
    if (droppedNoToken > 0 || droppedUnparseable > 0) {
      logger.debug(
        `satellite: syslog dropped ${droppedNoToken} untokened + ` +
          `${droppedUnparseable} unparseable lines`,
      );
    }
  }

  return { start, stop };
}
