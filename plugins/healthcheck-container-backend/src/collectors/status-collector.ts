import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeRate,
  mergeAverage,
  VersionedAggregated,
  aggregatedRate,
  aggregatedAverage,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type { ContainerTransportClient } from "@checkstack/healthcheck-container-common";
import { pluginMetadata } from "../plugin-metadata";

// ============================================================================
// CONFIG
// ============================================================================

const statusConfigSchema = z.object({});

export type ContainerStatusConfig = z.infer<typeof statusConfigSchema>;

// ============================================================================
// RESULT
// ============================================================================
//
// Every field is an assertable metric. A stopped or missing container is a
// COMPLETED inspect, never a collector failure - the operator asserts on
// `running` / `exists` / `state` to decide health.

const statusResultSchema = healthResultSchema({
  exists: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Exists",
    "x-chart-true-label": "present",
    "x-chart-false-label": "missing",
    "x-anomaly-enabled": false,
  }),
  running: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Running",
    "x-chart-true-label": "running",
    "x-chart-false-label": "stopped",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-good-direction": "up",
  }).optional(),
  state: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "State",
    "x-anomaly-enabled": false,
  }).optional(),
  health: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Health",
    "x-anomaly-enabled": false,
  }).optional(),
  exitCode: healthResultNumber({
    "x-chart-type": "status",
    "x-chart-label": "Exit Code",
    "x-anomaly-enabled": false,
  }).optional(),
  restartCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Restart Count",
    // Cumulative and monotonic; charting a trend is useful, anomaly detection
    // on a monotonic counter is not meaningful.
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
  }).optional(),
  oomKilled: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "OOM Killed",
    "x-chart-true-label": "oom-killed",
    "x-chart-false-label": "ok",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type ContainerStatusResult = z.infer<typeof statusResultSchema>;

const statusAggregatedFields = {
  runningRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Running Rate",
    "x-chart-unit": "%",
    // Legitimately dips during deploys/restarts; keep chartable, let assertions
    // own health so a rolling restart does not fire an anomaly alert.
    "x-anomaly-enabled": false,
  }),
  avgRestartCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Restart Count",
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
  }),
};

export type ContainerStatusAggregatedResult = InferAggregatedResult<
  typeof statusAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class ContainerStatusCollector
  implements
    CollectorStrategy<
      ContainerTransportClient,
      ContainerStatusConfig,
      ContainerStatusResult,
      ContainerStatusAggregatedResult
    >
{
  id = "container-status";
  displayName = "Container Status";
  description =
    "State, health, exit code and restart count of the container (all assertable)";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: statusConfigSchema });
  result = new Versioned({ version: 1, schema: statusResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: statusAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: ContainerStatusConfig;
    client: ContainerTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<ContainerStatusResult>> {
    const response = await client.exec({ type: "inspect" });
    if (response.type !== "inspect") {
      // Unreachable in practice (exec echoes the command type); keep the
      // narrow exhaustive without a cast.
      return { result: { exists: false } };
    }

    return {
      result: {
        exists: response.exists,
        running: response.running,
        state: response.state,
        health: response.health,
        exitCode: response.exitCode,
        restartCount: response.restartCount,
        oomKilled: response.oomKilled,
      },
    };
  }

  mergeResult(
    existing: ContainerStatusAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ContainerStatusResult>,
  ): ContainerStatusAggregatedResult {
    const metadata = run.metadata;
    return {
      runningRate: mergeRate(existing?.runningRate, metadata?.running ?? false),
      avgRestartCount: mergeAverage(
        existing?.avgRestartCount,
        metadata?.restartCount,
      ),
    };
  }
}
