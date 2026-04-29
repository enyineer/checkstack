import type { CollectorRegistry, Logger, SafeDatabase } from "@checkstack/backend-api";
import type { CacheProvider } from "@checkstack/cache-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import type { HealthCheckApi, HealthCheckRunResult } from "@checkstack/healthcheck-common";
import { getHealthResultMeta } from "@checkstack/healthcheck-common";
import {
  ANOMALY_BASELINE_UPDATED,
  computeDominance,
  computeLinearRegressionSlope,
  computeMean,
  computeStdDev,
  type AnomalyDirection,
  type FieldBaseline,
} from "@checkstack/anomaly-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { SignalService } from "@checkstack/signal-common";
import type { z } from "zod";
import * as schema from "../schema";
import { AnomalyService } from "../service";
import { evaluateDrift } from "../drift-evaluator";

export const BASELINE_ANALYZER_QUEUE = "anomaly-baseline-analyzer";

/** Minimum data points required before any baseline is persisted (cold start). */
const MIN_BASELINE_SAMPLES = 24;

export async function setupBaselineAnalyzerJob({
  db,
  cache,
  logger,
  queueManager,
  healthCheckClient,
  signalService,
  catalogClient,
  collectorRegistry,
}: {
  db: SafeDatabase<typeof schema>;
  cache: CacheProvider;
  logger: Logger;
  queueManager: QueueManager;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  signalService?: SignalService;
  catalogClient: InferClient<typeof CatalogApi>;
  collectorRegistry: CollectorRegistry;
}) {
  const queue = queueManager.getQueue(BASELINE_ANALYZER_QUEUE);
  const anomalyService = new AnomalyService(db);

  await queue.consume(
    async (_job) => {
      logger.debug("Running anomaly baseline analyzer background job...");

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const activeAssignments = await healthCheckClient.getRunsForAnalysis({
        startDate: sevenDaysAgo,
        limitPerAssignment: 200,
      });

      for (const assignment of activeAssignments) {
        // Per-assignment configuration is fetched once and reused per field.
        let templateConfig;
        let assignmentConfig;
        try {
          const templateRecord = await anomalyService.getAnomalyConfig(
            assignment.configurationId,
          );
          templateConfig = templateRecord.data;
          const assignmentRecord =
            await anomalyService.getAnomalyAssignmentConfig(
              assignment.systemId,
              assignment.configurationId,
            );
          assignmentConfig = assignmentRecord?.data;
        } catch (error) {
          logger.warn(
            `Failed to fetch anomaly config for ${assignment.configurationId}; skipping drift evaluation`,
            error,
          );
        }

        const fieldValues: Record<string, (string | boolean | number)[]> = {};
        const fieldCollectorIds: Record<string, string> = {};
        const fieldNames: Record<string, string> = {};

        // `getRunsForAnalysis` returns runs in DESCENDING timestamp order.
        // Iterate in reverse so per-field arrays end up chronologically ascending —
        // a property the regression slope relies on.
        for (let i = assignment.runs.length - 1; i >= 0; i--) {
          const row = assignment.runs[i];
          if (!row.result) continue;

          const result = row.result as HealthCheckRunResult;

          if (typeof result.latencyMs === "number") {
            const fullPath = "latencyMs";
            if (!fieldValues[fullPath]) fieldValues[fullPath] = [];
            fieldValues[fullPath].push(result.latencyMs);
          }

          const collectors = result.metadata?.collectors;
          if (!collectors) continue;

          for (const collectorData of Object.values(collectors)) {
            if (typeof collectorData !== "object" || collectorData === null) continue;
            const data = collectorData as Record<string, unknown>;
            const realCollectorId = data._collectorId;
            if (typeof realCollectorId !== "string") continue;

            for (const [fieldName, value] of Object.entries(data)) {
              if (fieldName === "_collectorId" || fieldName.startsWith("_")) continue;
              if (
                typeof value !== "number" &&
                typeof value !== "string" &&
                typeof value !== "boolean"
              ) {
                continue;
              }
              const fullPath = `collectors.${realCollectorId}.${fieldName}`;
              if (!fieldValues[fullPath]) fieldValues[fullPath] = [];
              fieldValues[fullPath].push(value);
              fieldCollectorIds[fullPath] = realCollectorId;
              fieldNames[fullPath] = fieldName;
            }
          }
        }

        for (const [path, values] of Object.entries(fieldValues)) {
          if (values.length < MIN_BASELINE_SAMPLES) continue;

          let mean = 0;
          let stdDev = 0;
          let trendSlope = 0;
          let dominantValue: string | undefined;
          let dominantRatio: number | undefined;

          if (typeof values[0] === "number") {
            const numValues = values as number[];
            mean = computeMean(numValues);
            stdDev = computeStdDev(numValues);
            trendSlope = computeLinearRegressionSlope(numValues);
          }

          const dom = computeDominance(values);
          if (dom.dominantValue !== undefined) {
            dominantValue = String(dom.dominantValue);
            dominantRatio = dom.dominantRatio;
          }

          const baseline = {
            mean,
            stdDev,
            trendSlope,
            dominantValue,
            dominantRatio,
            sampleCount: values.length,
            computedAt: new Date(),
          };

          await db
            .insert(schema.anomalyBaselines)
            .values({
              systemId: assignment.systemId,
              configurationId: assignment.configurationId,
              fieldPath: path,
              ...baseline,
            })
            .onConflictDoUpdate({
              target: [
                schema.anomalyBaselines.systemId,
                schema.anomalyBaselines.configurationId,
                schema.anomalyBaselines.fieldPath,
              ],
              set: baseline,
            });

          const cacheKey = `baseline:${assignment.configurationId}:${assignment.systemId}:${path}`;
          await cache.set(
            cacheKey,
            { ...baseline, computedAt: baseline.computedAt.toISOString() },
            1000 * 60 * 60 * 24,
          );

          if (signalService && typeof values[0] === "number") {
            await signalService.broadcast(ANOMALY_BASELINE_UPDATED, {
              systemId: assignment.systemId,
              configurationId: assignment.configurationId,
              fieldPath: path,
              mean: baseline.mean,
              stdDev: baseline.stdDev,
              sampleCount: baseline.sampleCount,
            });
          }

          // Drift evaluation runs only for numeric fields scoped to a collector
          // (the path layout `collectors.${id}.${field}`). Run-level fields like
          // `latencyMs` are skipped because we have no schema-declared direction
          // for them.
          if (typeof values[0] !== "number") continue;
          const collectorId = fieldCollectorIds[path];
          const fieldName = fieldNames[path];
          if (!collectorId || !fieldName) continue;

          const schemaDirection = lookupSchemaDirection({
            collectorRegistry,
            collectorId,
            fieldName,
          });

          const baselineDto: FieldBaseline = {
            ...baseline,
            computedAt: baseline.computedAt.toISOString(),
          };

          await evaluateDrift({
            db,
            logger,
            catalogClient,
            signalService,
            systemId: assignment.systemId,
            configurationId: assignment.configurationId,
            fieldPath: path,
            baseline: baselineDto,
            schemaDirection,
            templateConfig,
            assignmentConfig,
          });
        }
      }

      logger.debug("Anomaly baselines successfully recomputed.");
    },
    {
      consumerGroup: "anomaly-workers",
    },
  );

  // Schedule to run every hour
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: "hourly-baseline-analysis",
      cronPattern: "0 * * * *",
    },
  );

  logger.debug("Anomaly baseline analyzer job scheduled.");
}

function lookupSchemaDirection({
  collectorRegistry,
  collectorId,
  fieldName,
}: {
  collectorRegistry: CollectorRegistry;
  collectorId: string;
  fieldName: string;
}): AnomalyDirection | undefined {
  const collector = collectorRegistry.getCollector(collectorId);
  if (!collector) return undefined;
  const collectorSchema = collector.collector.result.schema;
  if (!("shape" in collectorSchema)) return undefined;
  const shape = collectorSchema.shape as Record<string, z.ZodTypeAny>;
  const fieldSchema = shape[fieldName];
  if (!fieldSchema) return undefined;
  const meta = getHealthResultMeta(fieldSchema);
  return meta?.["x-anomaly-direction"];
}
