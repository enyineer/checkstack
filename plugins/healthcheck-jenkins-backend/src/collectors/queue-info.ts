import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeMinMax,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import { healthResultNumber } from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { JenkinsTransportClient } from "../transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const queueInfoConfigSchema = z.object({});

export type QueueInfoConfig = z.infer<typeof queueInfoConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const queueInfoResultSchema = z.object({
  queueLength: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Queue Length",
  }),
  blockedCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Blocked Items",
  }),
  buildableCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Buildable Items",
  }),
  stuckCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Stuck Items",
  }),
  oldestWaitingMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Oldest Wait Time",
    "x-chart-unit": "ms",
  }),
  avgWaitingMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Wait Time",
    "x-chart-unit": "ms",
  }),
});

export type QueueInfoResult = z.infer<typeof queueInfoResultSchema>;

// Aggregated result fields definition
const queueInfoAggregatedFields = {
  avgQueueLength: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Queue Length",
  }),
  maxQueueLength: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Queue Length",
  }),
  avgWaitTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Wait Time",
    "x-chart-unit": "ms",
  }),
};

// Type inferred from field definitions
export type QueueInfoAggregatedResult = InferAggregatedResult<
  typeof queueInfoAggregatedFields
>;

// ============================================================================
// QUEUE INFO COLLECTOR
// ============================================================================

/**
 * Collector for Jenkins build queue.
 * Monitors queue length and wait times.
 */
export class QueueInfoCollector implements CollectorStrategy<
  JenkinsTransportClient,
  QueueInfoConfig,
  QueueInfoResult,
  QueueInfoAggregatedResult
> {
  id = "queue-info";
  displayName = "Queue Info";
  description = "Monitor Jenkins build queue length and wait times";

  supportedPlugins = [pluginMetadata];

  config = new Versioned({ version: 1, schema: queueInfoConfigSchema });
  result = new Versioned({ version: 1, schema: queueInfoResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: queueInfoAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: QueueInfoConfig;
    client: JenkinsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<QueueInfoResult>> {
    const response = await client.exec({
      path: "/queue/api/json",
      query: {
        tree: "items[id,why,stuck,blocked,buildable,inQueueSince]",
      },
    });

    if (response.error) {
      return {
        result: {
          queueLength: 0,
          blockedCount: 0,
          buildableCount: 0,
          stuckCount: 0,
          oldestWaitingMs: 0,
          avgWaitingMs: 0,
        },
        error: response.error,
      };
    }

    const data = response.data as {
      items?: Array<{
        id?: number;
        why?: string;
        stuck?: boolean;
        blocked?: boolean;
        buildable?: boolean;
        inQueueSince?: number;
      }>;
    };

    const items = data.items || [];
    const now = Date.now();

    let blockedCount = 0;
    let buildableCount = 0;
    let stuckCount = 0;
    const waitTimes: number[] = [];

    for (const item of items) {
      if (item.blocked) blockedCount++;
      if (item.buildable) buildableCount++;
      if (item.stuck) stuckCount++;

      if (item.inQueueSince) {
        waitTimes.push(now - item.inQueueSince);
      }
    }

    const oldestWaitingMs = waitTimes.length > 0 ? Math.max(...waitTimes) : 0;
    const avgWaitingMs =
      waitTimes.length > 0
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
        : 0;

    const result: QueueInfoResult = {
      queueLength: items.length,
      blockedCount,
      buildableCount,
      stuckCount,
      oldestWaitingMs,
      avgWaitingMs,
    };

    // Warn if queue is backing up
    const hasIssue = stuckCount > 0 || items.length > 10;

    return {
      result,
      error: hasIssue
        ? `Queue has ${items.length} items${
            stuckCount > 0 ? `, ${stuckCount} stuck` : ""
          }`
        : undefined,
    };
  }

  mergeResult(
    existing: QueueInfoAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<QueueInfoResult>,
  ): QueueInfoAggregatedResult {
    const metadata = run.metadata;

    return {
      avgQueueLength: mergeAverage(
        existing?.avgQueueLength,
        metadata?.queueLength,
      ),
      maxQueueLength: mergeMinMax(
        existing?.maxQueueLength,
        metadata?.queueLength,
      ),
      avgWaitTime: mergeAverage(existing?.avgWaitTime, metadata?.avgWaitingMs),
    };
  }
}
