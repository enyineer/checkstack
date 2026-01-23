import * as grpc from "@grpc/grpc-js";
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
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  GrpcTransportClient,
  GrpcHealthRequest,
  GrpcHealthResponse,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * gRPC Health Checking Protocol status values
 */
export const GrpcHealthStatus = z.enum([
  "UNKNOWN",
  "SERVING",
  "NOT_SERVING",
  "SERVICE_UNKNOWN",
]);

export type GrpcHealthStatusType = z.infer<typeof GrpcHealthStatus>;

/**
 * Configuration schema for gRPC health checks.
 */
export const grpcConfigSchema = z.object({
  host: z.string().describe("gRPC server hostname"),
  port: z.number().int().min(1).max(65_535).describe("gRPC port"),
  service: z
    .string()
    .default("")
    .describe("Service name to check (empty for server health)"),
  useTls: z.boolean().default(false).describe("Use TLS connection"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Request timeout in milliseconds"),
});

export type GrpcConfig = z.infer<typeof grpcConfigSchema>;
export type GrpcConfigInput = z.input<typeof grpcConfigSchema>;

/**
 * Per-run result metadata.
 */
const grpcResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }),
  status: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type GrpcResult = z.infer<typeof grpcResultSchema>;

/** Aggregated field definitions for bucket merging */
const grpcAggregatedFields = {
  avgResponseTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
  servingCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Serving",
  }),
};

type GrpcAggregatedResult = InferAggregatedResult<typeof grpcAggregatedFields>;

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
  }): Promise<{ status: GrpcHealthStatusType }>;
}

// Default client using @grpc/grpc-js
const defaultGrpcClient: GrpcHealthClient = {
  check(options) {
    return new Promise((resolve, reject) => {
      const address = `${options.host}:${options.port}`;
      const credentials = options.useTls
        ? grpc.credentials.createSsl()
        : grpc.credentials.createInsecure();

      const client = new grpc.Client(address, credentials);

      // Use the standard gRPC Health Checking Protocol
      const healthCheckPath = "/grpc.health.v1.Health/Check";

      const methodDefinition: grpc.MethodDefinition<
        { service: string },
        { status: number }
      > = {
        path: healthCheckPath,
        requestStream: false,
        responseStream: false,
        requestSerialize: (message: { service: string }) =>
          Buffer.from(JSON.stringify(message)),
        requestDeserialize: (data: Buffer) => JSON.parse(data.toString()),
        responseSerialize: (message: { status: number }) =>
          Buffer.from(JSON.stringify(message)),
        responseDeserialize: (data: Buffer) => JSON.parse(data.toString()),
      };

      const deadline = new Date(Date.now() + options.timeout);

      client.makeUnaryRequest(
        methodDefinition.path,
        methodDefinition.requestSerialize,
        methodDefinition.responseDeserialize,
        { service: options.service },
        { deadline },
        (error, response) => {
          client.close();

          if (error) {
            reject(error);
            return;
          }

          // Map status codes to enum values
          const statusMap: Record<number, GrpcHealthStatusType> = {
            0: "UNKNOWN",
            1: "SERVING",
            2: "NOT_SERVING",
            3: "SERVICE_UNKNOWN",
          };

          resolve({
            status: statusMap[response?.status ?? 0] ?? "UNKNOWN",
          });
        },
      );
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class GrpcHealthCheckStrategy implements HealthCheckStrategy<
  GrpcConfig,
  GrpcTransportClient,
  GrpcResult,
  typeof grpcAggregatedFields
> {
  id = "grpc";
  displayName = "gRPC Health Check";
  description =
    "gRPC server health check using the standard Health Checking Protocol";

  private grpcClient: GrpcHealthClient;

  constructor(grpcClient: GrpcHealthClient = defaultGrpcClient) {
    this.grpcClient = grpcClient;
  }

  config: Versioned<GrpcConfig> = new Versioned({
    version: 2, // Bumped for createClient pattern
    schema: grpcConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no config changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  result: Versioned<GrpcResult> = new Versioned({
    version: 2,
    schema: grpcResultSchema,
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
    fields: grpcAggregatedFields,
  });

  mergeResult(
    existing: GrpcAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<GrpcResult>,
  ): GrpcAggregatedResult {
    const metadata = run.metadata;

    const avgResponseTime = mergeAverage(
      existing?.avgResponseTime,
      metadata?.responseTimeMs,
    );

    const isSuccess = metadata?.status === "SERVING";
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    const servingCount = mergeCounter(existing?.servingCount, isSuccess);

    return { avgResponseTime, successRate, errorCount, servingCount };
  }

  async createClient(
    config: GrpcConfigInput,
  ): Promise<ConnectedClient<GrpcTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const client: GrpcTransportClient = {
      exec: async (request: GrpcHealthRequest): Promise<GrpcHealthResponse> => {
        try {
          const result = await this.grpcClient.check({
            host: validatedConfig.host,
            port: validatedConfig.port,
            service: request.service,
            useTls: validatedConfig.useTls,
            timeout: validatedConfig.timeout,
          });
          return { status: result.status };
        } catch (error_) {
          const error =
            error_ instanceof Error ? error_.message : String(error_);
          return { status: "UNKNOWN", error };
        }
      },
    };

    return {
      client,
      close: () => {
        // gRPC client is per-request, nothing to close
      },
    };
  }
}
