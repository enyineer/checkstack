import type { SafeDatabase } from "@checkstack/backend-api";
import type { CacheProvider } from "@checkstack/cache-api";
import * as schema from "../schema";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";

import type { InferClient } from "@checkstack/common";
import type { HealthCheckApi } from "@checkstack/healthcheck-common";
import { computeMean, computeStdDev } from "@checkstack/anomaly-common";

export const BASELINE_ANALYZER_QUEUE = "anomaly-baseline-analyzer";

export async function setupBaselineAnalyzerJob({
  db,
  cache,
  logger,
  queueManager,
  healthCheckClient,
}: {
  db: SafeDatabase<typeof schema>;
  cache: CacheProvider;
  logger: Logger;
  queueManager: QueueManager;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
}) {
  const queue = queueManager.getQueue(BASELINE_ANALYZER_QUEUE);

  await queue.consume(
    async (_job) => {
      logger.debug("Running anomaly baseline analyzer background job...");
      
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Fetch active assignments and their recent runs across plugin boundaries securely via RPC
      const activeAssignments = await healthCheckClient.getRunsForAnalysis({
        startDate: sevenDaysAgo,
        limitPerAssignment: 200,
      });

      for (const assignment of activeAssignments) {
        const fieldValues: Record<string, number[]> = {};

        for (const row of assignment.runs) {
          if (!row.result) continue;
          
          const collectors = (row.result as Record<string, unknown>).collectors as Record<string, unknown> | undefined;
          if (!collectors) continue;

          for (const collectorData of Object.values(collectors)) {
            if (typeof collectorData === "object" && collectorData !== null) {
              const data = collectorData as Record<string, unknown>;
              const realCollectorId = data._collectorId;
              
              if (typeof realCollectorId === "string") {
                for (const [fieldName, value] of Object.entries(data)) {
                  if (fieldName === "_collectorId" || fieldName.startsWith("_")) continue;
                  if (typeof value === "number") {
                    const fullPath = `collectors.${realCollectorId}.${fieldName}`;
                    if (!fieldValues[fullPath]) fieldValues[fullPath] = [];
                    fieldValues[fullPath].push(value);
                  }
                }
              }
            }
          }
        }

        for (const [path, values] of Object.entries(fieldValues)) {
          if (values.length < 24) continue; // Minimum 24 data points required for a valid baseline (cold start)

          const mean = computeMean(values);
          const stdDev = computeStdDev(values);
          const trendSlope = 0; // Phase 1 does not use trend slope
          
          const baseline = {
            mean,
            stdDev,
            trendSlope,
            sampleCount: values.length,
            computedAt: new Date(),
          };

          await db.insert(schema.anomalyBaselines)
            .values({
              systemId: assignment.systemId,
              configurationId: assignment.configurationId,
              fieldPath: path,
              ...baseline
            })
            .onConflictDoUpdate({
              target: [
                schema.anomalyBaselines.systemId,
                schema.anomalyBaselines.configurationId,
                schema.anomalyBaselines.fieldPath
              ],
              set: baseline
            });

          const cacheKey = `baseline:${assignment.configurationId}:${assignment.systemId}:${path}`;
          await cache.set(cacheKey, {
            ...baseline,
            computedAt: baseline.computedAt.toISOString()
          }, 1000 * 60 * 60 * 24); // 24 hour TTL (it gets updated every hour anyway)
        }
      }

      logger.debug("Anomaly baselines successfully recomputed.");
    },
    {
      consumerGroup: "anomaly-workers",
    }
  );

  // Schedule to run every hour
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: "hourly-baseline-analysis",
      cronPattern: "0 * * * *", // every hour
    }
  );
  
  logger.debug("Anomaly baseline analyzer job scheduled.");
}
