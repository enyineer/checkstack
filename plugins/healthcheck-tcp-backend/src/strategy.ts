import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  z,
  configString,
  type ConnectedClient,
  type TransportTimings,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  TcpTransportClient,
  TcpConnectRequest,
  TcpConnectResult,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for TCP health checks.
 * Connection-only parameters - action params moved to BannerCollector.
 */
export const tcpConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable: supports `{{ environment.host }}` etc. so one config covers N
  // environments. Presence is enforced POST-RENDER in `createClient` (an empty
  // render must not silently connect to an empty host).
  host: configString({ "x-templatable": true }).describe(
    "Hostname or IP address. Supports templating, e.g. {{ environment.host }}",
  ),
  port: z.number().int().min(1).max(65_535).describe("TCP port number"),
});

/**
 * Post-render validator for the connection `host`. The stored value is a plain
 * templatable string, so presence cannot be checked at store time; the executor
 * renders `{{ environment.* }}` per environment, then this rejects a render that
 * collapsed to empty/whitespace (e.g. an env-less run). An empty host is a
 * config error that prevents the probe from running - transport-failure
 * semantics - not a "healthy" result.
 */
const renderedHostSchema = z.string().trim().min(1);

export type TcpConfig = z.infer<typeof tcpConfigSchema>;

// The migrate input is `unknown` per the versioning chain, so narrowing is
// done with `typeof`/`in` guards (no casts).

/** Type guard: the migrate input is a plain object whose keys can be probed. */
function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

/** Read a string field from a config blob. */
function readString(data: unknown, key: string): string | undefined {
  if (!isRecord(data)) return undefined;
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

/** Read a numeric field from a config blob. */
function readNumber(data: unknown, key: string): number | undefined {
  if (!isRecord(data)) return undefined;
  const value = data[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Per-run result metadata.
 */
const tcpResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-good-direction": "up",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  banner: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Banner",
    "x-anomaly-enabled": false,
  }).optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type TcpResult = z.infer<typeof tcpResultSchema>;

/** Aggregated field definitions for bucket merging */
const tcpAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency aggregate: widen the band and require practical-significance
    // floors so fast endpoints do not alert on small jitter.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability is the primary, real signal. Debounce so a single
    // transient failed bucket does not alert.
    "x-anomaly-confirmation-window": 3,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw per-bucket error count scales with how many runs land in a bucket,
    // so it has no stable baseline and is fully redundant with successRate
    // (which already captures the same failures as a rate). Charting stays
    // available; alerting is owned by successRate to avoid duplicate, noisy
    // alerts on the same failures.
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
    "x-chart-priority": 90,
  }),
};

type TcpAggregatedResult = InferAggregatedResult<typeof tcpAggregatedFields>;

// ============================================================================
// SOCKET INTERFACE (for testability)
// ============================================================================

export interface TcpSocket {
  connect(options: { host: string; port: number }): Promise<void>;
  read(timeout: number): Promise<string | undefined>;
  close(): void;
}

export type SocketFactory = () => TcpSocket;

// Default factory using Bun.connect
const defaultSocketFactory: SocketFactory = () => {
  let connectedSocket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
  let dataBuffer = "";

  return {
    async connect(options: { host: string; port: number }): Promise<void> {
      return new Promise((resolve, reject) => {
        Bun.connect({
          hostname: options.host,
          port: options.port,
          socket: {
            open(sock) {
              connectedSocket = sock;
              resolve();
            },
            data(_sock, data) {
              dataBuffer += data.toString();
            },
            error(_sock, error) {
              reject(error);
            },
            close() {
              // Connection closed
            },
          },
        });
      });
    },
    async read(timeout: number): Promise<string | undefined> {
      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          if (dataBuffer.length > 0) {
            resolve(dataBuffer);
          } else if (Date.now() - start > timeout) {
            // eslint-disable-next-line unicorn/no-useless-undefined
            resolve(undefined);
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    },
    close(): void {
      connectedSocket?.end();
    },
  };
};

// ============================================================================
// STRATEGY
// ============================================================================

export class TcpHealthCheckStrategy implements HealthCheckStrategy<
  TcpConfig,
  TcpTransportClient,
  TcpResult,
  typeof tcpAggregatedFields
> {
  id = "tcp";
  displayName = "TCP Health Check";
  description = "TCP port connectivity check with optional banner grab";
  category = StrategyCategory.NETWORKING;

  private socketFactory: SocketFactory;

  constructor(socketFactory: SocketFactory = defaultSocketFactory) {
    this.socketFactory = socketFactory;
  }

  config: Versioned<TcpConfig> = new Versioned({
    version: 2,
    schema: tcpConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Remove readBanner (moved to BannerCollector)",
        // IDEMPOTENT: only a genuine v1 blob still carries `readBanner`. A v1
        // row that happened to omit `readBanner` already matches the v2 shape
        // (`{ host, port, timeout }`), so passthrough is correct there too.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && "readBanner" in data) {
            return {
              host: readString(data, "host"),
              port: readNumber(data, "port"),
              timeout: readNumber(data, "timeout"),
            };
          }
          return data;
        },
      },
    ],
  });

  result: Versioned<TcpResult> = new Versioned({
    version: 2,
    schema: tcpResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: tcpAggregatedFields,
  });

  mergeResult(
    existing: TcpAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<TcpResult>,
  ): TcpAggregatedResult {
    const metadata = run.metadata;

    const avgConnectionTime = mergeAverage(
      existing?.avgConnectionTime,
      metadata?.connectionTimeMs,
    );

    const isSuccess = metadata?.connected ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgConnectionTime, successRate, errorCount };
  }

  async createClient(
    config: TcpConfig,
  ): Promise<ConnectedClient<TcpTransportClient>> {
    const validatedConfig = this.config.validate(config);

    // Post-render guard: `host` is a templatable string, so `.min(1)` cannot run
    // at store time. The executor has already rendered `{{ environment.* }}`
    // into `config.host`; reject a render that collapsed to empty here so the
    // run fails clearly instead of attempting an empty connection.
    const host = renderedHostSchema.safeParse(validatedConfig.host);
    if (!host.success) {
      throw new Error(
        `Rendered host is empty: ${JSON.stringify(validatedConfig.host)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }

    const socket = this.socketFactory();

    const connectStart = performance.now();
    await socket.connect({
      host: host.data,
      port: validatedConfig.port,
    });
    // The only meaningful sub-phase for a raw TCP probe is the connect itself.
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    const client: TcpTransportClient = {
      async exec(request: TcpConnectRequest): Promise<TcpConnectResult> {
        if (request.type === "read" && request.timeout) {
          const banner = await socket.read(request.timeout);
          return { connected: true, banner };
        }
        return { connected: true };
      },
    };

    return {
      client,
      timings,
      close: () => socket.close(),
    };
  }
}
