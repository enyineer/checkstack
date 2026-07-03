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
  GrpcTransportClient,
  GrpcHealthRequest,
  GrpcHealthResponse,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

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
export const grpcConfigSchema = baseStrategyConfigSchema.extend({
  host: z.string().describe("gRPC server hostname"),
  port: z.number().int().min(1).max(65_535).describe("gRPC port"),
  service: z
    .string()
    .default("")
    .describe("Service name to check (empty for server health)"),
  useTls: z.boolean().default(false).describe("Use TLS connection"),
});

export type GrpcConfig = z.infer<typeof grpcConfigSchema>;
export type GrpcConfigInput = z.input<typeof grpcConfigSchema>;

/**
 * Per-run result metadata.
 */
const grpcResultSchema = healthResultSchema({
  // Canonical availability signal for this strategy. A confirmation window
  // debounces single-sample connection flaps so a transient blip does not page.
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
    "x-chart-good-direction": "up",
    "x-chart-priority": 20,
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  // Informational echo of the gRPC status enum. Availability is already
  // captured by the `connected` boolean (dominance), so anomaly on the raw
  // status text only adds a redundant, noisy categorical signal. Disabled by
  // default; still chartable and opt-in.
  status: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
    "x-anomaly-enabled": false,
    "x-chart-priority": 20,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type GrpcResult = z.infer<typeof grpcResultSchema>;

/** Aggregated field definitions for bucket merging */
const grpcAggregatedFields = {
  avgResponseTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
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
    // A success rate is only a problem when it drops, so alert lower-is-better
    // with a few-percent absolute floor to ignore tiny dips below baseline.
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  // Raw counters scale with how many runs landed in a bucket, so a baseline
  // over them tracks sampling cadence rather than a real problem. The same
  // signal is already expressed as a stable percentage by `successRate`, so
  // these are disabled by default to avoid alert fatigue. Still chartable.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
    "x-chart-priority": 90,
  }),
  servingCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Serving",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
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
  category = StrategyCategory.APPLICATION;

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

    // The gRPC client is per-request: the channel connect, optional TLS
    // handshake, and unary RPC all happen inside a single makeUnaryRequest in
    // exec, so the only phase we can measure accurately is the full round-trip.
    // We map that to processingMs and deliberately omit connectMs/tlsMs rather
    // than fabricate a split we cannot observe (last-request-wins).
    const timings: TransportTimings = {};

    const client: GrpcTransportClient = {
      exec: async (request: GrpcHealthRequest): Promise<GrpcHealthResponse> => {
        const start = performance.now();
        try {
          const result = await this.grpcClient.check({
            host: validatedConfig.host,
            port: validatedConfig.port,
            service: request.service,
            useTls: validatedConfig.useTls,
            timeout: validatedConfig.timeout,
          });
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - start),
          );
          return { status: result.status };
        } catch (error_) {
          // A failed RPC still consumed time; record it so a slow-then-failing
          // server still surfaces a processing phase.
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - start),
          );
          const error = extractErrorMessage(error_);
          return { status: "UNKNOWN", error };
        }
      },
    };

    return {
      client,
      timings,
      close: () => {
        // gRPC client is per-request, nothing to close
      },
    };
  }
}
