import type {
  CollectorRegistry,
  Logger,
  SafeDatabase,
  VersionedRecord,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { sql } from "drizzle-orm";
import type { CacheProvider } from "@checkstack/cache-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import type { NotificationApi } from "@checkstack/notification-common";
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
  type AnomalySettings,
  type FieldBaseline,
  type PartialAnomalySettings,
} from "@checkstack/anomaly-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { SignalService } from "@checkstack/signal-common";
import type { z } from "zod";
import * as schema from "../schema";
import { AnomalyService, anomalyAssignmentKey } from "../service";
import { evaluateDrift, loadExistingDriftRows } from "../drift-evaluator";

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
  notificationClient,
  collectorRegistry,
}: {
  db: SafeDatabase<typeof schema>;
  cache: CacheProvider;
  logger: Logger;
  queueManager: QueueManager;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  signalService?: SignalService;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
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

      // Batch fix: preload BOTH per-assignment config reads for ALL assignments
      // set-based (one `inArray`/`OR` read each) under a SINGLE scoped
      // transaction, instead of 2 standalone SELECTs per assignment (an N+1
      // across the run). `getRunsForAnalysis` above is an RPC and stays OUTSIDE
      // the transaction; only these two pure-DB reads run inside it.
      let templateConfigs: Map<string, VersionedRecord<AnomalySettings>> =
        new Map();
      let assignmentConfigs: Map<
        string,
        VersionedRecord<PartialAnomalySettings>
      > = new Map();
      try {
        const preload = await withScopedTransaction(db, async (tx) => {
          const templates = await anomalyService.getAnomalyConfigsByIds({
            configurationIds: activeAssignments.map((a) => a.configurationId),
            runner: tx,
          });
          const assignments =
            await anomalyService.getAnomalyAssignmentConfigsByKeys({
              keys: activeAssignments.map((a) => ({
                systemId: a.systemId,
                configurationId: a.configurationId,
              })),
              runner: tx,
            });
          return { templates, assignments };
        });
        templateConfigs = preload.templates;
        assignmentConfigs = preload.assignments;
      } catch (error) {
        logger.warn(
          "Failed to preload anomaly configs for baseline analysis; proceeding without config overrides",
          error,
        );
      }

      for (const assignment of activeAssignments) {
        // Per-assignment configuration comes from the batch preload above,
        // reused across every per-environment fan-out within this assignment.
        // Missing ids fall back to the default template (see
        // getAnomalyConfigsByIds); a missing assignment override is `undefined`.
        const templateConfig = templateConfigs.get(
          assignment.configurationId,
        )?.data;
        const assignmentConfig = assignmentConfigs.get(
          anomalyAssignmentKey(assignment.systemId, assignment.configurationId),
        )?.data;

        // Fan out per environment so each env gets its own baseline. `null`
        // is the env-less slice (no environment membership) — preserved as a
        // distinct group so the pre-feature cross-env baseline survives as the
        // env-less row. Maps preserve insertion order, and getRunsForAnalysis
        // returns runs DESC by timestamp, so the first env we encounter leads
        // the iteration; ordering across envs is not significant.
        const runsByEnv = groupRunsByEnvironment(assignment.runs);

        for (const [environmentId, envRuns] of runsByEnv) {
          const fieldValues: Record<string, (string | boolean | number)[]> = {};
          const fieldCollectorIds: Record<string, string> = {};
          const fieldNames: Record<string, string> = {};

          // `getRunsForAnalysis` returns runs in DESCENDING timestamp order.
          // Iterate in reverse so per-field arrays end up chronologically
          // ascending — a property the regression slope relies on.
          for (let i = envRuns.length - 1; i >= 0; i--) {
            const row = envRuns[i];
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

          // Pass 1 (pure CPU): compute each field's baseline stats and collect
          // one insert row per qualifying field. Nothing touches the DB here.
          const baselineRows: (typeof schema.anomalyBaselines.$inferInsert)[] =
            [];
          const perField: Array<{
            path: string;
            baseline: {
              mean: number;
              stdDev: number;
              trendSlope: number;
              dominantValue: string | undefined;
              dominantRatio: number | undefined;
              sampleCount: number;
              computedAt: Date;
            };
            isNumeric: boolean;
            collectorId: string | undefined;
            fieldName: string | undefined;
          }> = [];

          for (const [path, values] of Object.entries(fieldValues)) {
            if (values.length < MIN_BASELINE_SAMPLES) continue;

            let mean = 0;
            let stdDev = 0;
            let trendSlope = 0;
            let dominantValue: string | undefined;
            let dominantRatio: number | undefined;
            const isNumeric = typeof values[0] === "number";

            if (isNumeric) {
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

            baselineRows.push({
              systemId: assignment.systemId,
              configurationId: assignment.configurationId,
              environmentId,
              fieldPath: path,
              mean: baseline.mean,
              stdDev: baseline.stdDev,
              trendSlope: baseline.trendSlope,
              sampleCount: baseline.sampleCount,
              computedAt: baseline.computedAt,
              dominantValue: baseline.dominantValue ?? null,
              dominantRatio: baseline.dominantRatio ?? null,
            });
            perField.push({
              path,
              baseline,
              isNumeric,
              collectorId: fieldCollectorIds[path],
              fieldName: fieldNames[path],
            });
          }

          if (baselineRows.length === 0) continue;

          // Batch fix: ONE multi-row `INSERT ... ON CONFLICT DO UPDATE` per env
          // (was one upsert per field). `excluded.*` writes each row's
          // freshly-computed value, so the per-row result is identical to the
          // previous single-row upserts.
          await db
            .insert(schema.anomalyBaselines)
            .values(baselineRows)
            .onConflictDoUpdate({
              target: [
                schema.anomalyBaselines.systemId,
                schema.anomalyBaselines.configurationId,
                schema.anomalyBaselines.environmentId,
                schema.anomalyBaselines.fieldPath,
              ],
              set: {
                mean: sql`excluded.mean`,
                stdDev: sql`excluded.std_dev`,
                trendSlope: sql`excluded.trend_slope`,
                sampleCount: sql`excluded.sample_count`,
                computedAt: sql`excluded.computed_at`,
                dominantValue: sql`excluded.dominant_value`,
                dominantRatio: sql`excluded.dominant_ratio`,
              },
            });

          // Per-field cache write + baseline-updated signal. These are NOT DB
          // ops (cache / event bus), so they stay out of any transaction.
          for (const f of perField) {
            // Cache key mirrors the detector's lookup, including the env slice
            // so a per-env baseline never shadows another env's cached entry.
            const cacheKey = `baseline:${assignment.configurationId}:${assignment.systemId}:${environmentId ?? "<none>"}:${f.path}`;
            await cache.set(
              cacheKey,
              {
                ...f.baseline,
                computedAt: f.baseline.computedAt.toISOString(),
              },
              1000 * 60 * 60 * 24,
            );

            if (signalService && f.isNumeric) {
              await signalService.broadcast(ANOMALY_BASELINE_UPDATED, {
                systemId: assignment.systemId,
                configurationId: assignment.configurationId,
                environmentId,
                fieldPath: f.path,
                mean: f.baseline.mean,
                stdDev: f.baseline.stdDev,
                sampleCount: f.baseline.sampleCount,
              });
            }
          }

          // Batch fix: preload ALL existing 'drift' rows for this env ONCE
          // (was one SELECT per field inside evaluateDrift — an N+1). Each field
          // is a distinct fieldPath, so the map read is equivalent to a fresh
          // per-field query.
          const existingDriftRows = await loadExistingDriftRows({
            db,
            systemId: assignment.systemId,
            configurationId: assignment.configurationId,
            environmentId,
          });

          // Drift evaluation runs only for numeric fields scoped to a collector
          // (the path layout `collectors.${id}.${field}`). Run-level fields like
          // `latencyMs` are skipped because we have no schema-declared direction
          // for them.
          for (const f of perField) {
            if (!f.isNumeric) continue;
            if (!f.collectorId || !f.fieldName) continue;

            const schemaInfo = lookupSchemaInfo({
              collectorRegistry,
              collectorId: f.collectorId,
              fieldName: f.fieldName,
            });

            const baselineDto: FieldBaseline = {
              ...f.baseline,
              computedAt: f.baseline.computedAt.toISOString(),
            };

            await evaluateDrift({
              db,
              logger,
              catalogClient,
              notificationClient,
              signalService,
              systemId: assignment.systemId,
              configurationId: assignment.configurationId,
              environmentId,
              fieldPath: f.path,
              baseline: baselineDto,
              schemaDirection: schemaInfo.direction,
              schemaSensitivity: schemaInfo.sensitivity,
              schemaConfirmationWindow: schemaInfo.confirmationWindow,
              schemaDriftEnabled: schemaInfo.driftEnabled,
              schemaDriftThreshold: schemaInfo.driftThreshold,
              schemaMinAbsoluteDelta: schemaInfo.minAbsoluteDelta,
              schemaMinRelativeDelta: schemaInfo.minRelativeDelta,
              templateConfig,
              assignmentConfig,
              existingDriftRows,
            });
          }
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

interface SchemaInfo {
  direction?: AnomalyDirection;
  sensitivity?: number;
  confirmationWindow?: number;
  driftEnabled?: boolean;
  driftThreshold?: number;
  minAbsoluteDelta?: number;
  minRelativeDelta?: number;
}

/**
 * Partition an assignment's runs by `environmentId` so each environment gets
 * its own baseline. `null` (env-less slice) is kept as a distinct key — the
 * pre-feature cross-env baseline survives as the env-less row. A `Map` preserves
 * the first-seen order of environments; ordering across envs is not
 * significant (each env's stats are computed independently), only the
 * chronological order of runs *within* an env group matters, and that is
 * preserved by appending in the same DESC order the upstream query returned.
 */
function groupRunsByEnvironment(
  runs: Array<{ result?: unknown; environmentId: string | null }>,
): Map<
  string | null,
  Array<{ result?: unknown; environmentId: string | null }>
> {
  const groups = new Map<
    string | null,
    Array<{ result?: unknown; environmentId: string | null }>
  >();
  for (const run of runs) {
    const key = run.environmentId ?? null;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(run);
  }
  return groups;
}

function lookupSchemaInfo({
  collectorRegistry,
  collectorId,
  fieldName,
}: {
  collectorRegistry: CollectorRegistry;
  collectorId: string;
  fieldName: string;
}): SchemaInfo {
  const collector = collectorRegistry.getCollector(collectorId);
  if (!collector) return {};
  const collectorSchema = collector.collector.result.schema;
  if (!("shape" in collectorSchema)) return {};
  const shape = collectorSchema.shape as Record<string, z.ZodTypeAny>;
  const fieldSchema = shape[fieldName];
  if (!fieldSchema) return {};
  const meta = getHealthResultMeta(fieldSchema);
  return {
    direction: meta?.["x-anomaly-direction"],
    sensitivity: meta?.["x-anomaly-sensitivity"],
    confirmationWindow: meta?.["x-anomaly-confirmation-window"],
    driftEnabled: meta?.["x-anomaly-drift-enabled"],
    driftThreshold: meta?.["x-anomaly-drift-threshold"],
    minAbsoluteDelta: meta?.["x-anomaly-min-absolute-delta"],
    minRelativeDelta: meta?.["x-anomaly-min-relative-delta"],
  };
}
