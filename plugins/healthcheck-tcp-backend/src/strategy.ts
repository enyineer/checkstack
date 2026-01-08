import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  stringField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
} from "@checkmate-monitor/healthcheck-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for TCP health checks using shared factories.
 */
const tcpAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("connectionTime"),
  stringField("banner"),
]);

export type TcpAssertion = z.infer<typeof tcpAssertionSchema>;

/**
 * Configuration schema for TCP health checks.
 */
export const tcpConfigSchema = z.object({
  host: z.string().describe("Hostname or IP address"),
  port: z.number().int().min(1).max(65_535).describe("TCP port number"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  readBanner: z
    .boolean()
    .default(false)
    .describe("Read initial banner/greeting from server"),
  assertions: z
    .array(tcpAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type TcpConfig = z.infer<typeof tcpConfigSchema>;

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
  failedAssertion: tcpAssertionSchema.optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

export type TcpResult = z.infer<typeof tcpResultSchema>;

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

export type TcpAggregatedResult = z.infer<typeof tcpAggregatedSchema>;

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
  let socket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
  let receivedData = "";

  return {
    async connect(options: { host: string; port: number }): Promise<void> {
      return new Promise((resolve, reject) => {
        Bun.connect({
          hostname: options.host,
          port: options.port,
          socket: {
            open(sock) {
              socket = sock;
              resolve();
            },
            data(_sock, data) {
              receivedData += new TextDecoder().decode(data);
            },
            error(_sock, error) {
              reject(error);
            },
            close() {
              // Connection closed
            },
          },
        }).catch(reject);
      });
    },
    async read(timeout: number): Promise<string | undefined> {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (receivedData.length > 0) {
          const data = receivedData;
          receivedData = "";
          return data;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return receivedData.length > 0 ? receivedData : undefined;
    },
    close(): void {
      socket?.end();
    },
  };
};

// ============================================================================
// STRATEGY
// ============================================================================

export class TcpHealthCheckStrategy
  implements HealthCheckStrategy<TcpConfig, TcpResult, TcpAggregatedResult>
{
  id = "tcp";
  displayName = "TCP Health Check";
  description = "TCP port connectivity check with optional banner grab";

  private socketFactory: SocketFactory;

  constructor(socketFactory: SocketFactory = defaultSocketFactory) {
    this.socketFactory = socketFactory;
  }

  config: Versioned<TcpConfig> = new Versioned({
    version: 1,
    schema: tcpConfigSchema,
  });

  result: Versioned<TcpResult> = new Versioned({
    version: 1,
    schema: tcpResultSchema,
  });

  aggregatedResult: Versioned<TcpAggregatedResult> = new Versioned({
    version: 1,
    schema: tcpAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<TcpResult>[]
  ): TcpAggregatedResult {
    let totalConnectionTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let validRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.status === "healthy") {
        successCount++;
      }
      if (run.metadata) {
        totalConnectionTime += run.metadata.connectionTimeMs;
        validRuns++;
      }
    }

    return {
      avgConnectionTime: validRuns > 0 ? totalConnectionTime / validRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
    };
  }

  async execute(config: TcpConfig): Promise<HealthCheckResult<TcpResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    const socket = this.socketFactory();

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Connection timeout")),
          validatedConfig.timeout
        );
      });

      // Connect to host
      await Promise.race([
        socket.connect({
          host: validatedConfig.host,
          port: validatedConfig.port,
        }),
        timeoutPromise,
      ]);

      const connectionTimeMs = Math.round(performance.now() - start);

      // Read banner if requested
      let banner: string | undefined;
      if (validatedConfig.readBanner) {
        const bannerTimeout = Math.max(
          1000,
          validatedConfig.timeout - connectionTimeMs
        );
        banner = (await socket.read(bannerTimeout)) ?? undefined;
      }

      socket.close();

      const result: Omit<TcpResult, "failedAssertion" | "error"> = {
        connected: true,
        connectionTimeMs,
        banner,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        connectionTime: connectionTimeMs,
        banner: banner ?? "",
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs,
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      return {
        status: "healthy",
        latencyMs: connectionTimeMs,
        message: `Connected to ${validatedConfig.host}:${
          validatedConfig.port
        } in ${connectionTimeMs}ms${
          banner ? ` (banner: ${banner.slice(0, 50)}...)` : ""
        }`,
        metadata: result,
      };
    } catch (error: unknown) {
      socket.close();
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "TCP connection failed",
        metadata: {
          connected: false,
          connectionTimeMs: Math.round(end - start),
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
