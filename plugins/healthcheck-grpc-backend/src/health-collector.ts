import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { GrpcTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const healthConfigSchema = z.object({
  service: z
    .string()
    .default("")
    .describe("Service name to check (empty for overall)"),
});

export type HealthConfig = z.infer<typeof healthConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const grpcHealthResultSchema = healthResultSchema({
  status: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
  }),
  serving: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Serving",
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }),
});

export type HealthResult = z.infer<typeof grpcHealthResultSchema>;

// Aggregated result fields definition
const healthAggregatedFields = {
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  servingRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Serving Rate",
    "x-chart-unit": "%",
  }),
};

// Type inferred from field definitions
export type HealthAggregatedResult = InferAggregatedResult<
  typeof healthAggregatedFields
>;

// ============================================================================
// HEALTH COLLECTOR
// ============================================================================

/**
 * Built-in gRPC health collector.
 * Checks gRPC health status using the standard Health Checking Protocol.
 */
export class HealthCollector implements CollectorStrategy<
  GrpcTransportClient,
  HealthConfig,
  HealthResult,
  HealthAggregatedResult
> {
  id = "health";
  displayName = "gRPC Health Check";
  description = "Check gRPC service health status";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: healthConfigSchema });
  result = new Versioned({ version: 1, schema: grpcHealthResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: healthAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: HealthConfig;
    client: GrpcTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<HealthResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      service: config.service,
    });

    const responseTimeMs = Date.now() - startTime;
    const serving = response.status === "SERVING";

    return {
      result: {
        status: response.status,
        serving,
        responseTimeMs,
      },
      error:
        response.error ?? (serving ? undefined : `Status: ${response.status}`),
    };
  }

  mergeResult(
    existing: HealthAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<HealthResult>,
  ): HealthAggregatedResult {
    const metadata = run.metadata;

    return {
      avgResponseTimeMs: mergeAverage(
        existing?.avgResponseTimeMs,
        metadata?.responseTimeMs,
      ),
      servingRate: mergeRate(existing?.servingRate, metadata?.serving),
    };
  }
}
