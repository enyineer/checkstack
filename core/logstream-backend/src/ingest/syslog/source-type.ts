/**
 * Syslog as the FIRST telemetry platform LISTENER source type.
 *
 * A "listener" source holds a long-lived inbound socket that physically lives on
 * ONE pod. The telemetry platform's pod-local listener manager
 * (`core/telemetry-backend`'s `createListenerManager`) runs one listener per
 * ENABLED instance per pod and calls the stop closure returned from `start` on
 * shutdown / disable / config change. This module supplies the syslog listener:
 * it binds a TCP (optionally TLS) socket, frames RFC 6587, parses RFC 5424, and
 * emits normalized log records through the bound sink.
 *
 * AUTHORIZATION MODEL - the big change from the old env-gated listener. The old
 * `listener.ts` resolved a `ckls_` source token from EACH message (structured
 * data or a MSG prefix), verified it per connection, and routed each line to the
 * token's stream. On the platform path there is NO in-message token: the source
 * INSTANCE binding is the authorization and the routing. A user configures a
 * syslog source instance, binds it to a log stream (the sink's `assertBindable`
 * checks their grant at bind time), and every line this socket receives goes to
 * that bound stream. So this module does no token handling whatsoever.
 *
 * NOT the satellite receiver. `core/satellite`'s syslog receiver is a separate,
 * unchanged mechanism: an EDGE receiver that forwards over the satellite WS
 * channel and still uses the in-message token branch of
 * `parseSyslog5424`/`resolveToken`. That token branch stays in logstream-common
 * for the satellite path; only THIS host-side listener drops it.
 *
 * MULTI-POD (see `.claude/rules/state-and-scale.md`): every pod independently
 * tries to bind the configured port. What happens next depends on topology:
 * with per-pod network namespaces (the normal Kubernetes case) EVERY pod binds
 * successfully and a Service/load balancer distributes connections across
 * them; on a shared host network the first pod wins and the rest fail with
 * `EADDRINUSE`, which the listener manager records as the instance's
 * `lastError` and does not crash - expected for a single-bind listener,
 * exactly as documented on the manager in `listeners.ts`.
 */

import { z } from "zod";
import {
  SyslogFramer,
  parseSyslog5424,
  syslogToNormalizedLogRecord,
} from "@checkstack/logstream-common";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import {
  defineTelemetrySourceType,
  type TelemetryListenerContext,
} from "@checkstack/telemetry-backend";

/** Default cap on concurrent syslog TCP connections per pod (per instance). */
export const DEFAULT_SYSLOG_MAX_CONNECTIONS = 100;

/**
 * Config for a syslog listener instance.
 *
 * TLS uses FILE PATHS, not inline PEM. Justification:
 * - A private key + full cert chain are large; the platform's inline-secret
 *   channel (`configSecret` / top-level `x-secret` strings) is built for short
 *   tokens, and `assertConfigSecretFieldsValid` forbids the NESTED secret fields
 *   a natural `tls: { cert, key }` grouping would need. Paths keep the clean
 *   nested shape and put NO key material in the DB config at all.
 * - Certs are provisioned by infra and mounted into the container filesystem
 *   (the standard Kubernetes TLS-secret volume), so rotating a mounted cert
 *   needs no config edit - this matches how the old env-var listener consumed
 *   `CHECKSTACK_LOGSTREAM_SYSLOG_TLS_CERT`/`_KEY`.
 * - A path is not sensitive and is only ever handed to Bun's TLS loader; a bad
 *   path fails `start` (recorded as `lastError`) and never echoes file content.
 */
export const SyslogSourceConfigSchema = z.object({
  /** TCP port to bind. */
  port: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .describe(
      "TCP port the listener binds to receive RFC 5424 syslog (e.g. 514, or 6514 for TLS).",
    ),
  /** Bind address; default all interfaces. */
  host: z
    .string()
    .min(1)
    .default("0.0.0.0")
    .describe("Bind address for the listener. Defaults to 0.0.0.0 (all interfaces)."),
  /** Max concurrent connections before new ones are rejected. */
  maxConnections: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(DEFAULT_SYSLOG_MAX_CONNECTIONS)
    .describe(
      "Maximum concurrent TCP connections; connections beyond this cap are rejected.",
    ),
  /** Enable syslog-over-TLS by pointing at a mounted cert + key (PEM files). */
  tls: z
    .object({
      certPath: z
        .string()
        .min(1)
        .describe(
          "Filesystem path to the PEM certificate (chain) file mounted into the container.",
        ),
      keyPath: z
        .string()
        .min(1)
        .describe(
          "Filesystem path to the PEM private key file mounted into the container.",
        ),
    })
    .optional()
    .describe(
      "Enable syslog-over-TLS by pointing at a mounted PEM cert and key. Omit for plain TCP.",
    ),
});
export type SyslogSourceConfig = z.infer<typeof SyslogSourceConfigSchema>;

/** Per-connection state: just a framer (no token/verdict cache anymore). */
interface ConnectionState {
  framer: SyslogFramer;
}

/**
 * Build the Bun TLS option from a resolved config, or undefined for plain TCP.
 * The cert/key are `Bun.file` refs (read lazily on the first handshake).
 * {@link startSyslogListener} validates the configured paths up front (see
 * {@link assertSyslogTlsReadable}) so a bad path fails `start` rather than every
 * handshake. Extracted so the construction is unit-testable without a live TLS
 * handshake.
 */
export function buildSyslogTls(
  config: SyslogSourceConfig,
): { cert: Bun.BunFile; key: Bun.BunFile } | undefined {
  if (!config.tls) return undefined;
  return {
    cert: Bun.file(config.tls.certPath),
    key: Bun.file(config.tls.keyPath),
  };
}

/**
 * Fail `start` with a clear, path-naming error when a configured TLS cert or key
 * file is missing or empty. Because {@link buildSyslogTls} wraps them as LAZY
 * `Bun.file` refs (read on the first handshake), without this pre-flight a
 * listener with a wrong/missing path BINDS successfully and looks healthy while
 * every TLS handshake fails per-connection (swallowed as socket-error warns).
 * Validating the files up front turns that silent failure into a thrown `start`,
 * which the listener manager records as the instance's `lastError` - the
 * observable failure we want. Exported for unit testing.
 */
export async function assertSyslogTlsReadable({
  certPath,
  keyPath,
}: {
  certPath: string;
  keyPath: string;
}): Promise<void> {
  for (const [label, path] of [
    ["certPath", certPath],
    ["keyPath", keyPath],
  ] as const) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(
        `logstream: syslog TLS ${label} file not found or not readable: ${path}`,
      );
    }
    if (file.size === 0) {
      throw new Error(`logstream: syslog TLS ${label} file is empty: ${path}`);
    }
  }
}

/**
 * Start a syslog listener for one instance and return its stop closure. Pure
 * over its dependencies (the resolved `config`, the bound `sink`, a `logger`)
 * so it is unit-testable against a real ephemeral-port `Bun.listen`. Rejects on
 * unreadable TLS material (see {@link assertSyslogTlsReadable}) or a bind failure
 * (`EADDRINUSE`) - the listener manager records either as the instance's
 * `lastError`.
 */
export async function startSyslogListener(
  ctx: TelemetryListenerContext<SyslogSourceConfig>,
): Promise<() => void> {
  const { config, sink, logger } = ctx;
  let droppedUnparseable = 0;
  let activeConnections = 0;
  let rejectedConnections = 0;

  async function handleMessages(messages: string[]): Promise<void> {
    const records: NormalizedLogRecord[] = [];
    const now = new Date();
    for (const raw of messages) {
      const parsed = parseSyslog5424(raw);
      if (!parsed) {
        droppedUnparseable += 1;
        continue;
      }
      records.push(syslogToNormalizedLogRecord({ parsed, now }));
    }
    if (records.length === 0) return;
    // The instance binding routes "logs" to the bound stream; an emit for a
    // signal the instance did not bind returns `bound: false` (a legal no-op).
    await sink.emit("logs", records);
  }

  // Validate TLS material BEFORE binding: a missing/empty cert or key must fail
  // `start` (recorded as the instance's `lastError`), not bind cleanly and then
  // fail every handshake per-connection.
  if (config.tls) await assertSyslogTlsReadable(config.tls);
  const tls = buildSyslogTls(config);

  const server = Bun.listen<ConnectionState>({
    hostname: config.host,
    port: config.port,
    ...(tls ? { tls } : {}),
    socket: {
      open(socket) {
        if (activeConnections >= config.maxConnections) {
          rejectedConnections += 1;
          if (rejectedConnections === 1 || rejectedConnections % 100 === 0) {
            logger.warn(
              `logstream: syslog connection cap ${config.maxConnections} reached; ` +
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
        // Only decrement for a connection we actually counted (a rejected,
        // over-cap connection was never assigned `data` nor counted).
        if (socket.data && activeConnections > 0) activeConnections -= 1;
      },
      data(socket, chunk) {
        // A rejected (over-cap) connection has no data assigned; ignore bytes
        // that raced in before the FIN.
        if (!socket.data) return;
        const { messages, reset } = socket.data.framer.push(
          new Uint8Array(chunk),
        );
        if (reset) {
          logger.warn("logstream: syslog framing reset (malformed frame)");
        }
        if (messages.length > 0) {
          void handleMessages(messages).catch((error: unknown) =>
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
    `logstream: syslog listener on ${config.host}:${config.port}` +
      (tls ? " (TLS)" : ""),
  );

  return () => {
    // `stop(true)` force-closes the socket AND every live connection.
    server.stop(true);
    if (droppedUnparseable > 0) {
      logger.debug(
        `logstream: syslog dropped ${droppedUnparseable} unparseable line(s)`,
      );
    }
  };
}

/**
 * The syslog listener source type. Registered against
 * `telemetrySourceExtensionPoint` in the plugin's `init()` (see the wiring in
 * `index.ts`).
 */
export const syslogSourceType = defineTelemetrySourceType<SyslogSourceConfig>({
  id: "syslog",
  displayName: "Syslog",
  description:
    "Receive RFC 5424 syslog over TCP (optionally TLS). Every line on the " +
    "bound socket is routed to the bound log stream - the instance binding is " +
    "the authorization, so no per-message token is needed.",
  icon: "Network",
  signals: ["logs"],
  configSchema: SyslogSourceConfigSchema,
  listener: {
    start: startSyslogListener,
  },
});
