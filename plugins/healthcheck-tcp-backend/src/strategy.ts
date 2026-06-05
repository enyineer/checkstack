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
  type ConnectedClient,
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
  host: z.string().describe("Hostname or IP address"),
  port: z.number().int().min(1).max(65_535).describe("TCP port number"),
});

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
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
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
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
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
    const socket = this.socketFactory();

    await socket.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
    });

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
      close: () => socket.close(),
    };
  }
}
