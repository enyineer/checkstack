import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  VersionedAggregated,
  aggregatedAverage,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type { ContainerTransportClient } from "@checkstack/healthcheck-container-common";
import { pluginMetadata } from "../plugin-metadata";

// ============================================================================
// CONFIG
// ============================================================================

const statsConfigSchema = z.object({});

export type ContainerStatsConfig = z.infer<typeof statsConfigSchema>;

// ============================================================================
// RESULT
// ============================================================================

const statsResultSchema = healthResultSchema({
  cpuPercent: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "CPU",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-chart-priority": 10,
  }).optional(),
  memoryPercent: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Memory",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-chart-priority": 20,
  }).optional(),
  memoryUsageBytes: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Memory Usage",
    "x-chart-unit": "bytes",
    // Redundant with memoryPercent for alerting; chartable, anomaly off.
    "x-anomaly-enabled": false,
    "x-chart-priority": 80,
  }).optional(),
  memoryLimitBytes: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Memory Limit",
    "x-chart-unit": "bytes",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }).optional(),
});

export type ContainerStatsResult = z.infer<typeof statsResultSchema>;

const statsAggregatedFields = {
  avgCpuPercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg CPU",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-chart-priority": 10,
  }),
  avgMemoryPercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Memory",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-chart-priority": 20,
  }),
};

export type ContainerStatsAggregatedResult = InferAggregatedResult<
  typeof statsAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class ContainerStatsCollector
  implements
    CollectorStrategy<
      ContainerTransportClient,
      ContainerStatsConfig,
      ContainerStatsResult,
      ContainerStatsAggregatedResult
    >
{
  id = "container-stats";
  displayName = "Container Stats";
  description = "CPU and memory usage of the container";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: statsConfigSchema });
  result = new Versioned({ version: 1, schema: statsResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: statsAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: ContainerStatsConfig;
    client: ContainerTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<ContainerStatsResult>> {
    const response = await client.exec({ type: "stats" });
    if (response.type !== "stats") {
      return { result: {} };
    }

    return {
      result: {
        cpuPercent: response.cpuPercent,
        memoryPercent: response.memoryPercent,
        memoryUsageBytes: response.memoryUsageBytes,
        memoryLimitBytes: response.memoryLimitBytes,
      },
    };
  }

  mergeResult(
    existing: ContainerStatsAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ContainerStatsResult>,
  ): ContainerStatsAggregatedResult {
    const metadata = run.metadata;
    return {
      avgCpuPercent: mergeAverage(
        existing?.avgCpuPercent,
        metadata?.cpuPercent,
      ),
      avgMemoryPercent: mergeAverage(
        existing?.avgMemoryPercent,
        metadata?.memoryPercent,
      ),
    };
  }
}
