import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
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

const healthResultSchema = z.object({
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

export type HealthResult = z.infer<typeof healthResultSchema>;

const healthAggregatedSchema = z.object({
  avgResponseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  servingRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Serving Rate",
    "x-chart-unit": "%",
  }),
});

export type HealthAggregatedResult = z.infer<typeof healthAggregatedSchema>;

// ============================================================================
// HEALTH COLLECTOR
// ============================================================================

/**
 * Built-in gRPC health collector.
 * Checks gRPC health status using the standard Health Checking Protocol.
 */
export class HealthCollector
  implements
    CollectorStrategy<
      GrpcTransportClient,
      HealthConfig,
      HealthResult,
      HealthAggregatedResult
    >
{
  id = "health";
  displayName = "gRPC Health Check";
  description = "Check gRPC service health status";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: healthConfigSchema });
  result = new Versioned({ version: 1, schema: healthResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: healthAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<HealthResult>[]
  ): HealthAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.responseTimeMs)
      .filter((v): v is number => typeof v === "number");

    const servingResults = runs
      .map((r) => r.metadata?.serving)
      .filter((v): v is boolean => typeof v === "boolean");

    const servingCount = servingResults.filter(Boolean).length;

    return {
      avgResponseTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
      servingRate:
        servingResults.length > 0
          ? Math.round((servingCount / servingResults.length) * 100)
          : 0,
    };
  }
}
