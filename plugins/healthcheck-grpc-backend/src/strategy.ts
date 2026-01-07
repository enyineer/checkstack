import * as grpc from "@grpc/grpc-js";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  enumField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * gRPC Health Checking Protocol status values
 * https://github.com/grpc/grpc/blob/master/doc/health-checking.md
 */
const GrpcHealthStatus = z.enum([
  "UNKNOWN",
  "SERVING",
  "NOT_SERVING",
  "SERVICE_UNKNOWN",
]);
export type GrpcHealthStatus = z.infer<typeof GrpcHealthStatus>;

/**
 * Assertion schema for gRPC health checks using shared factories.
 * Uses enumField for status to render a dropdown with valid status values.
 */
const grpcAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("responseTime"),
  enumField("status", GrpcHealthStatus.options),
]);

export type GrpcAssertion = z.infer<typeof grpcAssertionSchema>;

/**
 * Configuration schema for gRPC health checks.
 */
export const grpcConfigSchema = z.object({
  host: z.string().describe("gRPC server hostname"),
  port: z.number().int().min(1).max(65_535).describe("gRPC port"),
  service: z
    .string()
    .default("")
    .describe("Service name to check (empty for overall server health)"),
  useTls: z.boolean().default(false).describe("Use TLS/SSL connection"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Request timeout in milliseconds"),
  assertions: z
    .array(grpcAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type GrpcConfig = z.infer<typeof grpcConfigSchema>;
export type GrpcConfigInput = z.input<typeof grpcConfigSchema>;

/**
 * Per-run result metadata.
 */
const grpcResultSchema = z.object({
  connected: z.boolean(),
  responseTimeMs: z.number(),
  status: GrpcHealthStatus,
  failedAssertion: grpcAssertionSchema.optional(),
  error: z.string().optional(),
});

export type GrpcResult = z.infer<typeof grpcResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const grpcAggregatedSchema = z.object({
  avgResponseTime: z.number(),
  successRate: z.number(),
  errorCount: z.number(),
  servingCount: z.number(),
});

export type GrpcAggregatedResult = z.infer<typeof grpcAggregatedSchema>;

// ============================================================================
// GRPC CLIENT INTERFACE (for testability)
// ============================================================================

export interface GrpcHealthClient {
  check(options: {
    host: string;
    port: number;
    service: string;
    useTls: boolean;
    timeout: number;
  }): Promise<{ status: GrpcHealthStatus }>;
}

// Default client using @grpc/grpc-js
const defaultGrpcClient: GrpcHealthClient = {
  async check(options) {
    return new Promise((resolve, reject) => {
      const credentials = options.useTls
        ? grpc.credentials.createSsl()
        : grpc.credentials.createInsecure();

      // Create health check client manually using makeGenericClientConstructor
      const HealthService = grpc.makeGenericClientConstructor(
        {
          Check: {
            path: "/grpc.health.v1.Health/Check",
            requestStream: false,
            responseStream: false,
            requestSerialize: (message: { service: string }) =>
              Buffer.from(JSON.stringify(message)),
            requestDeserialize: (data: Buffer) =>
              JSON.parse(data.toString()) as { service: string },
            responseSerialize: (message: { status: number }) =>
              Buffer.from(JSON.stringify(message)),
            responseDeserialize: (data: Buffer) =>
              JSON.parse(data.toString()) as { status: number },
          },
        },
        "grpc.health.v1.Health"
      );

      const client = new HealthService(
        `${options.host}:${options.port}`,
        credentials
      );

      const deadline = new Date(Date.now() + options.timeout);

      client.Check(
        { service: options.service },
        { deadline },
        (
          err: grpc.ServiceError | null,
          response: { status: number } | undefined
        ) => {
          client.close();

          if (err) {
            reject(err);
            return;
          }

          // Map status number to enum
          const statusMap: Record<number, GrpcHealthStatus> = {
            0: "UNKNOWN",
            1: "SERVING",
            2: "NOT_SERVING",
            3: "SERVICE_UNKNOWN",
          };

          resolve({
            status: statusMap[response?.status ?? 0] ?? "UNKNOWN",
          });
        }
      );
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class GrpcHealthCheckStrategy
  implements HealthCheckStrategy<GrpcConfig, GrpcResult, GrpcAggregatedResult>
{
  id = "grpc";
  displayName = "gRPC Health Check";
  description =
    "gRPC server health check using the standard Health Checking Protocol";

  private grpcClient: GrpcHealthClient;

  constructor(grpcClient: GrpcHealthClient = defaultGrpcClient) {
    this.grpcClient = grpcClient;
  }

  config: Versioned<GrpcConfig> = new Versioned({
    version: 1,
    schema: grpcConfigSchema,
  });

  result: Versioned<GrpcResult> = new Versioned({
    version: 1,
    schema: grpcResultSchema,
  });

  aggregatedResult: Versioned<GrpcAggregatedResult> = new Versioned({
    version: 1,
    schema: grpcAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<GrpcResult>[]
  ): GrpcAggregatedResult {
    let totalResponseTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let servingCount = 0;
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
        totalResponseTime += run.metadata.responseTimeMs;
        if (run.metadata.status === "SERVING") {
          servingCount++;
        }
        validRuns++;
      }
    }

    return {
      avgResponseTime: validRuns > 0 ? totalResponseTime / validRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
      servingCount,
    };
  }

  async execute(
    config: GrpcConfigInput
  ): Promise<HealthCheckResult<GrpcResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      const response = await this.grpcClient.check({
        host: validatedConfig.host,
        port: validatedConfig.port,
        service: validatedConfig.service,
        useTls: validatedConfig.useTls,
        timeout: validatedConfig.timeout,
      });

      const responseTimeMs = Math.round(performance.now() - start);

      const result: Omit<GrpcResult, "failedAssertion" | "error"> = {
        connected: true,
        responseTimeMs,
        status: response.status,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        responseTime: responseTimeMs,
        status: response.status,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: responseTimeMs,
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      // Check if service is SERVING
      if (response.status !== "SERVING") {
        return {
          status: "unhealthy",
          latencyMs: responseTimeMs,
          message: `gRPC health status: ${response.status}`,
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs: responseTimeMs,
        message: `gRPC service ${
          validatedConfig.service || "(root)"
        } is SERVING`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "gRPC health check failed",
        metadata: {
          connected: false,
          responseTimeMs: Math.round(end - start),
          status: "UNKNOWN",
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
