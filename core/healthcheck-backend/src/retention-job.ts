import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  healthCheckRuns,
  systemHealthChecks,
  healthCheckAggregates,
  healthCheckStateTransitions,
  DEFAULT_RETENTION_CONFIG,
} from "./schema";
import { eq, and, lt, sql, desc } from "drizzle-orm";
import {
  ASSERTIONS_AGG_KEY,
  mergeAssertionStats,
  readAssertionStats,
  type BucketAssertionStats,
} from "@checkstack/healthcheck-common";
import type { QueueManager } from "@checkstack/queue-api";

type Db = SafeDatabase<typeof schema>;

interface RetentionJobDeps {
  db: Db;
  logger: Logger;
  queueManager: QueueManager;
}

const RETENTION_QUEUE = "health-check-retention";

interface RetentionJobPayload {
  trigger: "scheduled";
}

/**
 * Registers and runs the daily retention job that:
 * 1. Aggregates old raw runs into hourly buckets
 * 2. Rolls up old hourly aggregates into daily
 * 3. Deletes expired daily aggregates
 */
export async function setupRetentionJob(deps: RetentionJobDeps) {
  const { queueManager, logger, db } = deps;

  const queue = queueManager.getQueue<RetentionJobPayload>(RETENTION_QUEUE);

  // Register consumer for retention jobs
  await queue.consume(
    async () => {
      logger.info("Starting health check retention job");
      await runRetentionJob({
        db,
        logger,
        queueManager,
      });
      logger.info("Completed health check retention job");
    },
    { consumerGroup: "retention-worker" },
  );

  // Schedule daily retention run (86400 seconds = 24 hours)
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: "health-check-retention-daily",
      intervalSeconds: 24 * 60 * 60, // Daily (24 hours)
    },
  );

  logger.info("Health check retention job scheduled (runs daily)");
}

/**
 * Main retention job logic
 */
export async function runRetentionJob(deps: RetentionJobDeps) {
  const { db, logger } = deps;

  // Get all unique system-config assignments
  const assignments = await db.select().from(systemHealthChecks);

  // State transitions are system-level (not per-config), so prune them
  // once per unique system rather than once per assignment. Use the
  // longest rawRetentionDays among the system's assignments so a single
  // short-retention check can't drop history another check still wants.
  const rawRetentionBySystem = new Map<string, number>();
  for (const assignment of assignments) {
    const days = (
      assignment.retentionConfig ?? DEFAULT_RETENTION_CONFIG
    ).rawRetentionDays;
    const existing = rawRetentionBySystem.get(assignment.systemId);
    if (existing === undefined || days > existing) {
      rawRetentionBySystem.set(assignment.systemId, days);
    }
  }

  for (const [systemId, rawRetentionDays] of rawRetentionBySystem) {
    try {
      await pruneStateTransitions({ db, systemId, rawRetentionDays });
    } catch (error) {
      logger.error(`State-transition prune failed for ${systemId}`, { error });
    }
  }

  for (const assignment of assignments) {
    const retentionConfig =
      assignment.retentionConfig ?? DEFAULT_RETENTION_CONFIG;

    try {
      // 1. Delete expired raw runs (aggregation now happens in real-time)
      await deleteExpiredRawRuns({
        db,
        systemId: assignment.systemId,
        configurationId: assignment.configurationId,
        rawRetentionDays: retentionConfig.rawRetentionDays,
      });

      // 2. Roll up old hourly aggregates into daily
      await rollupHourlyAggregates({
        db,
        systemId: assignment.systemId,
        configurationId: assignment.configurationId,
        hourlyRetentionDays: retentionConfig.hourlyRetentionDays,
      });

      // 3. Delete expired daily aggregates
      await deleteExpiredAggregates({
        db,
        systemId: assignment.systemId,
        configurationId: assignment.configurationId,
        dailyRetentionDays: retentionConfig.dailyRetentionDays,
      });
    } catch (error) {
      logger.error(
        `Retention job failed for ${assignment.systemId}/${assignment.configurationId}`,
        { error },
      );
    }
  }
}

interface DeleteExpiredRawRunsParams {
  db: Db;
  systemId: string;
  configurationId: string;
  rawRetentionDays: number;
}

/**
 * Deletes raw runs older than retention period.
 * Aggregation now happens in real-time via incrementHourlyAggregate.
 */
async function deleteExpiredRawRuns(params: DeleteExpiredRawRunsParams) {
  const { db, systemId, configurationId, rawRetentionDays } = params;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rawRetentionDays);

  // Status-cache note: this delete does NOT invalidate the system-health status
  // cache, and deliberately need not. `evaluateHealthStatus` derives status from
  // the most-recent-N runs (count-based, no time component), and the cutoff is
  // days old, so for any ACTIVELY-running check the deleted rows are already
  // outside the evaluation window — removing them cannot change the current
  // derived status. The only case it could is a check that STOPPED running long
  // enough for its entire history to age past the cutoff; that flip is bounded by
  // the 15s status-cache TTL (an acceptable, rare edge for a stopped check).
  await db
    .delete(healthCheckRuns)
    .where(
      and(
        eq(healthCheckRuns.systemId, systemId),
        eq(healthCheckRuns.configurationId, configurationId),
        lt(healthCheckRuns.timestamp, cutoffDate),
      ),
    );
}

interface PruneStateTransitionsParams {
  db: Db;
  systemId: string;
  rawRetentionDays: number;
}

/**
 * Prune aggregate state-transition rows older than the raw-run retention
 * window, but ALWAYS keep the single most-recent transition for the
 * system so "in current status since" never blanks for an active streak
 * (decision D3). Deletes rows that are both older than the cutoff AND
 * not the newest row.
 */
export async function pruneStateTransitions(
  params: PruneStateTransitionsParams,
): Promise<void> {
  const { db, systemId, rawRetentionDays } = params;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rawRetentionDays);

  const [newest] = await db
    .select({ id: healthCheckStateTransitions.id })
    .from(healthCheckStateTransitions)
    .where(eq(healthCheckStateTransitions.systemId, systemId))
    .orderBy(desc(healthCheckStateTransitions.transitionedAt))
    .limit(1);

  const conditions = [
    eq(healthCheckStateTransitions.systemId, systemId),
    lt(healthCheckStateTransitions.transitionedAt, cutoffDate),
  ];
  if (newest) {
    // Never delete the most-recent row, even if it predates the cutoff.
    conditions.push(sql`${healthCheckStateTransitions.id} <> ${newest.id}`);
  }

  await db.delete(healthCheckStateTransitions).where(and(...conditions));
}

interface RollupParams {
  db: Db;
  systemId: string;
  configurationId: string;
  hourlyRetentionDays: number;
}

/**
 * The ON CONFLICT target for the daily-aggregate upsert. It MUST list exactly
 * the columns of the `health_check_aggregates_bucket_unique` constraint
 * (configurationId, systemId, environmentId, bucketStart, bucketSize, sourceId)
 * - Postgres rejects an ON CONFLICT whose target does not match a real unique
 * constraint with SQLSTATE 42P10. `retention-rollup.test.ts` asserts this stays
 * in lock-step with the schema so the rollup can never throw 42P10 again.
 */
export const DAILY_AGGREGATE_CONFLICT_TARGET = [
  healthCheckAggregates.configurationId,
  healthCheckAggregates.systemId,
  healthCheckAggregates.environmentId,
  healthCheckAggregates.bucketStart,
  healthCheckAggregates.bucketSize,
  healthCheckAggregates.sourceId,
] as const;

/** Truncate a timestamp to the start of its (local) day. */
function dayStartOf(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** The subset of an hourly aggregate row the rollup math needs. */
export interface HourlyAggregateRow {
  bucketStart: Date;
  environmentId: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  runCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  latencySumMs: number | null;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Carried for the per-assertion pass/fail counts (additive across hours). */
  aggregatedResult?: Record<string, unknown> | null;
}

/** A computed daily aggregate ready to upsert. */
export interface DailyAggregateValues {
  bucketStart: Date;
  environmentId: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  runCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  latencySumMs: number | undefined;
  avgLatencyMs: number | undefined;
  minLatencyMs: number | undefined;
  maxLatencyMs: number | undefined;
  p95LatencyMs: number | undefined;
  /**
   * Summed per-assertion pass/fail counts across the day's hourly buckets.
   * The ONLY part of `aggregatedResult` that survives the daily rollup —
   * assertion counts are purely additive, unlike strategy/collector states.
   */
  assertionStats: BucketAssertionStats | undefined;
}

/**
 * Fold hourly aggregates into daily ones. CRITICAL: rows are grouped by
 * (day, environmentId, sourceId) - the same dimensions as the unique key - so
 * distinct per-environment / per-source series stay separate instead of being
 * collapsed into one `environmentId=null` daily row. Counts sum; latency sum
 * folds (with avg*count fallback); min/max/p95 fold across the group.
 */
export function buildDailyAggregates(
  oldHourly: HourlyAggregateRow[],
): DailyAggregateValues[] {
  const groups = new Map<string, HourlyAggregateRow[]>();

  for (const row of oldHourly) {
    const key = JSON.stringify([
      dayStartOf(row.bucketStart).toISOString(),
      row.environmentId,
      row.sourceId,
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const result: DailyAggregateValues[] = [];
  for (const rows of groups.values()) {
    let runCount = 0;
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let latencySumMs = 0;
    let assertionStats: BucketAssertionStats | undefined;

    for (const a of rows) {
      runCount += a.runCount;
      healthyCount += a.healthyCount;
      degradedCount += a.degradedCount;
      unhealthyCount += a.unhealthyCount;
      // Use latencySumMs if available, fallback to avg*count approximation.
      if (a.latencySumMs !== null) {
        latencySumMs += a.latencySumMs;
      } else if (a.avgLatencyMs !== null) {
        latencySumMs += a.avgLatencyMs * a.runCount;
      }
      assertionStats = mergeAssertionStats({
        a: assertionStats,
        b: readAssertionStats({
          aggregatedResult: a.aggregatedResult ?? undefined,
        }),
      });
    }

    const minValues = rows
      .map((a) => a.minLatencyMs)
      .filter((v): v is number => v !== null);
    const maxValues = rows
      .map((a) => a.maxLatencyMs)
      .filter((v): v is number => v !== null);
    const p95Values = rows
      .map((a) => a.p95LatencyMs)
      .filter((v): v is number => v !== null);

    result.push({
      bucketStart: dayStartOf(rows[0].bucketStart),
      environmentId: rows[0].environmentId,
      sourceId: rows[0].sourceId,
      sourceLabel: rows[0].sourceLabel,
      runCount,
      healthyCount,
      degradedCount,
      unhealthyCount,
      latencySumMs: latencySumMs > 0 ? latencySumMs : undefined,
      avgLatencyMs:
        runCount > 0 ? Math.round(latencySumMs / runCount) : undefined,
      minLatencyMs: minValues.length > 0 ? Math.min(...minValues) : undefined,
      maxLatencyMs: maxValues.length > 0 ? Math.max(...maxValues) : undefined,
      // Use max of hourly p95s as an upper-bound approximation.
      p95LatencyMs: p95Values.length > 0 ? Math.max(...p95Values) : undefined,
      assertionStats,
    });
  }

  return result;
}

/**
 * Rolls up hourly aggregates older than retention period into daily buckets
 */
async function rollupHourlyAggregates(params: RollupParams) {
  const { db, systemId, configurationId, hourlyRetentionDays } = params;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - hourlyRetentionDays);
  cutoffDate.setHours(0, 0, 0, 0); // Round to day

  // Get old hourly aggregates
  const oldHourly = await db
    .select()
    .from(healthCheckAggregates)
    .where(
      and(
        eq(healthCheckAggregates.systemId, systemId),
        eq(healthCheckAggregates.configurationId, configurationId),
        eq(healthCheckAggregates.bucketSize, "hourly"),
        lt(healthCheckAggregates.bucketStart, cutoffDate),
      ),
    );

  if (oldHourly.length === 0) return;

  // Fold into daily aggregates, preserving (day, environmentId, sourceId) series.
  for (const daily of buildDailyAggregates(oldHourly)) {
    const newLatencySum = daily.latencySumMs;

    // Assertion pass/fail counts are the ONLY aggregatedResult content that
    // survives the daily rollup (strategy/collector states cannot combine
    // across hours). The conflict path merges in JS by pre-reading the
    // existing daily row — safe because retention runs in a single work-queue
    // consumer group, so there is no concurrent writer for this tuple.
    let dailyAggregatedResult: Record<string, unknown> | undefined;
    if (daily.assertionStats !== undefined) {
      const [existingDaily] = await db
        .select({ aggregatedResult: healthCheckAggregates.aggregatedResult })
        .from(healthCheckAggregates)
        .where(
          and(
            eq(healthCheckAggregates.systemId, systemId),
            eq(healthCheckAggregates.configurationId, configurationId),
            eq(healthCheckAggregates.bucketSize, "daily"),
            eq(healthCheckAggregates.bucketStart, daily.bucketStart),
            daily.environmentId === null
              ? sql`${healthCheckAggregates.environmentId} IS NULL`
              : eq(healthCheckAggregates.environmentId, daily.environmentId),
            daily.sourceId === null
              ? sql`${healthCheckAggregates.sourceId} IS NULL`
              : eq(healthCheckAggregates.sourceId, daily.sourceId),
          ),
        );
      const mergedStats = mergeAssertionStats({
        a: readAssertionStats({
          aggregatedResult: existingDaily?.aggregatedResult ?? undefined,
        }),
        b: daily.assertionStats,
      });
      if (mergedStats !== undefined) {
        dailyAggregatedResult = { [ASSERTIONS_AGG_KEY]: mergedStats };
      }
    }

    // Upsert the daily aggregate. A row may already exist for this
    // (configurationId, systemId, environmentId, day, daily, sourceId) tuple if
    // a prior rollup ran and then late-arriving hourly buckets (e.g. from a
    // satellite that was offline) were rolled up afterwards. Merge in that case
    // rather than crashing — sums add, min/max/p95 fold.
    await db
      .insert(healthCheckAggregates)
      .values({
        configurationId,
        systemId,
        environmentId: daily.environmentId,
        sourceId: daily.sourceId,
        sourceLabel: daily.sourceLabel,
        bucketStart: daily.bucketStart,
        bucketSize: "daily",
        runCount: daily.runCount,
        healthyCount: daily.healthyCount,
        degradedCount: daily.degradedCount,
        unhealthyCount: daily.unhealthyCount,
        latencySumMs: newLatencySum,
        avgLatencyMs: daily.avgLatencyMs,
        minLatencyMs: daily.minLatencyMs,
        maxLatencyMs: daily.maxLatencyMs,
        p95LatencyMs: daily.p95LatencyMs,
        // Only the additive assertion counts survive across hours.
        aggregatedResult: dailyAggregatedResult,
      })
      .onConflictDoUpdate({
        target: [...DAILY_AGGREGATE_CONFLICT_TARGET],
        set: {
          runCount: sql`${healthCheckAggregates.runCount} + ${daily.runCount}`,
          healthyCount: sql`${healthCheckAggregates.healthyCount} + ${daily.healthyCount}`,
          degradedCount: sql`${healthCheckAggregates.degradedCount} + ${daily.degradedCount}`,
          unhealthyCount: sql`${healthCheckAggregates.unhealthyCount} + ${daily.unhealthyCount}`,
          latencySumMs: sql`COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${newLatencySum ?? 0}`,
          avgLatencyMs: sql`CASE WHEN (${healthCheckAggregates.runCount} + ${daily.runCount}) > 0 THEN (COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${newLatencySum ?? 0}) / (${healthCheckAggregates.runCount} + ${daily.runCount}) ELSE ${healthCheckAggregates.avgLatencyMs} END`,
          minLatencyMs:
            daily.minLatencyMs === undefined
              ? sql`${healthCheckAggregates.minLatencyMs}`
              : sql`LEAST(COALESCE(${healthCheckAggregates.minLatencyMs}, ${daily.minLatencyMs}), ${daily.minLatencyMs})`,
          maxLatencyMs:
            daily.maxLatencyMs === undefined
              ? sql`${healthCheckAggregates.maxLatencyMs}`
              : sql`GREATEST(COALESCE(${healthCheckAggregates.maxLatencyMs}, ${daily.maxLatencyMs}), ${daily.maxLatencyMs})`,
          p95LatencyMs:
            daily.p95LatencyMs === undefined
              ? sql`${healthCheckAggregates.p95LatencyMs}`
              : sql`GREATEST(COALESCE(${healthCheckAggregates.p95LatencyMs}, ${daily.p95LatencyMs}), ${daily.p95LatencyMs})`,
          // JS-merged above (existing row's counts + this rollup's counts).
          ...(dailyAggregatedResult === undefined
            ? {}
            : { aggregatedResult: dailyAggregatedResult }),
        },
      });
  }

  // Delete the processed hourly aggregates (all were folded into daily rows).
  for (const hourly of oldHourly) {
    await db
      .delete(healthCheckAggregates)
      .where(eq(healthCheckAggregates.id, hourly.id));
  }
}

interface DeleteExpiredParams {
  db: Db;
  systemId: string;
  configurationId: string;
  dailyRetentionDays: number;
}

/**
 * Deletes daily aggregates older than retention period
 */
async function deleteExpiredAggregates(params: DeleteExpiredParams) {
  const { db, systemId, configurationId, dailyRetentionDays } = params;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - dailyRetentionDays);

  await db
    .delete(healthCheckAggregates)
    .where(
      and(
        eq(healthCheckAggregates.systemId, systemId),
        eq(healthCheckAggregates.configurationId, configurationId),
        eq(healthCheckAggregates.bucketSize, "daily"),
        lt(healthCheckAggregates.bucketStart, cutoffDate),
      ),
    );
}
