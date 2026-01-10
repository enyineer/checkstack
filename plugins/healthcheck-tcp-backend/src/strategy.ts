import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
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
export const tcpConfigSchema = z.object({
  host: z.string().describe("Hostname or IP address"),
  port: z.number().int().min(1).max(65_535).describe("TCP port number"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Connection timeout in milliseconds"),
});

export type TcpConfig = z.infer<typeof tcpConfigSchema>;

// Legacy config type for migrations
interface TcpConfigV1 {
  host: string;
  port: number;
  timeout: number;
  readBanner: boolean;
}

/**
 * Per-run result metadata.
 */
const tcpResultSchema = z.object({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  banner: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Banner",
  }).optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type TcpResult = z.infer<typeof tcpResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const tcpAggregatedSchema = z.object({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

type TcpAggregatedResult = z.infer<typeof tcpAggregatedSchema>;

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

export class TcpHealthCheckStrategy
  implements
    HealthCheckStrategy<
      TcpConfig,
      TcpTransportClient,
      TcpResult,
      TcpAggregatedResult
    >
{
  id = "tcp";
  displayName = "TCP Health Check";
  description = "TCP port connectivity check with optional banner grab";

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
        migrate: (data: TcpConfigV1): TcpConfig => ({
          host: data.host,
          port: data.port,
          timeout: data.timeout,
        }),
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

  aggregatedResult: Versioned<TcpAggregatedResult> = new Versioned({
    version: 1,
    schema: tcpAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<TcpResult>[]
  ): TcpAggregatedResult {
    const validRuns = runs.filter((r) => r.metadata);

    if (validRuns.length === 0) {
      return { avgConnectionTime: 0, successRate: 0, errorCount: 0 };
    }

    const connectionTimes = validRuns
      .map((r) => r.metadata?.connectionTimeMs)
      .filter((t): t is number => typeof t === "number");

    const avgConnectionTime =
      connectionTimes.length > 0
        ? Math.round(
            connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length
          )
        : 0;

    const successCount = validRuns.filter(
      (r) => r.metadata?.connected === true
    ).length;
    const successRate = Math.round((successCount / validRuns.length) * 100);

    const errorCount = validRuns.filter(
      (r) => r.metadata?.error !== undefined
    ).length;

    return { avgConnectionTime, successRate, errorCount };
  }

  async createClient(
    config: TcpConfig
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
