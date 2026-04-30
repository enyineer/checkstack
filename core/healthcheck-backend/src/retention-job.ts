import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  healthCheckRuns,
  systemHealthChecks,
  healthCheckAggregates,
  DEFAULT_RETENTION_CONFIG,
} from "./schema";
import { eq, and, lt, sql } from "drizzle-orm";
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

interface RollupParams {
  db: Db;
  systemId: string;
  configurationId: string;
  hourlyRetentionDays: number;
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

  // Group by day
  const dailyBuckets = new Map<
    string,
    {
      bucketStart: Date;
      aggregates: typeof oldHourly;
    }
  >();

  for (const hourly of oldHourly) {
    const dayStart = new Date(hourly.bucketStart);
    dayStart.setHours(0, 0, 0, 0);
    const key = dayStart.toISOString();

    if (!dailyBuckets.has(key)) {
      dailyBuckets.set(key, { bucketStart: dayStart, aggregates: [] });
    }
    dailyBuckets.get(key)!.aggregates.push(hourly);
  }

  // Create daily aggregates
  for (const [, bucket] of dailyBuckets) {
    let runCount = 0;
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let latencySumMs = 0;

    for (const a of bucket.aggregates) {
      runCount += a.runCount;
      healthyCount += a.healthyCount;
      degradedCount += a.degradedCount;
      unhealthyCount += a.unhealthyCount;
      // Use latencySumMs if available, fallback to avg*count approximation
      if (a.latencySumMs !== null) {
        latencySumMs += a.latencySumMs;
      } else if (a.avgLatencyMs !== null) {
        latencySumMs += a.avgLatencyMs * a.runCount;
      }
    }

    const avgLatencyMs =
      runCount > 0 ? Math.round(latencySumMs / runCount) : undefined;

    // Min/max across all hourly buckets
    const minValues = bucket.aggregates
      .map((a) => a.minLatencyMs)
      .filter((v): v is number => v !== null);
    const maxValues = bucket.aggregates
      .map((a) => a.maxLatencyMs)
      .filter((v): v is number => v !== null);
    const p95Values = bucket.aggregates
      .map((a) => a.p95LatencyMs)
      .filter((v): v is number => v !== null);
    const minLatencyMs =
      minValues.length > 0 ? Math.min(...minValues) : undefined;
    const maxLatencyMs =
      maxValues.length > 0 ? Math.max(...maxValues) : undefined;
    // Use max of hourly p95s as upper bound approximation
    const p95LatencyMs =
      p95Values.length > 0 ? Math.max(...p95Values) : undefined;

    // Upsert the daily aggregate. A row may already exist for this
    // (configurationId, systemId, day, daily, sourceId=null) tuple if a
    // prior rollup ran and then late-arriving hourly buckets (e.g. from
    // a satellite that was offline) were rolled up afterwards. Merge in
    // that case rather than crashing — sums add, min/max/p95 fold.
    const newLatencySum = latencySumMs > 0 ? latencySumMs : undefined;
    await db
      .insert(healthCheckAggregates)
      .values({
        configurationId,
        systemId,
        bucketStart: bucket.bucketStart,
        bucketSize: "daily",
        runCount,
        healthyCount,
        degradedCount,
        unhealthyCount,
        latencySumMs: newLatencySum,
        avgLatencyMs,
        minLatencyMs,
        maxLatencyMs,
        p95LatencyMs,
        aggregatedResult: undefined, // Cannot combine result across hours
      })
      .onConflictDoUpdate({
        target: [
          healthCheckAggregates.configurationId,
          healthCheckAggregates.systemId,
          healthCheckAggregates.bucketStart,
          healthCheckAggregates.bucketSize,
          healthCheckAggregates.sourceId,
        ],
        set: {
          runCount: sql`${healthCheckAggregates.runCount} + ${runCount}`,
          healthyCount: sql`${healthCheckAggregates.healthyCount} + ${healthyCount}`,
          degradedCount: sql`${healthCheckAggregates.degradedCount} + ${degradedCount}`,
          unhealthyCount: sql`${healthCheckAggregates.unhealthyCount} + ${unhealthyCount}`,
          latencySumMs: sql`COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${newLatencySum ?? 0}`,
          avgLatencyMs: sql`CASE WHEN (${healthCheckAggregates.runCount} + ${runCount}) > 0 THEN (COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${newLatencySum ?? 0}) / (${healthCheckAggregates.runCount} + ${runCount}) ELSE ${healthCheckAggregates.avgLatencyMs} END`,
          minLatencyMs:
            minLatencyMs === undefined
              ? sql`${healthCheckAggregates.minLatencyMs}`
              : sql`LEAST(COALESCE(${healthCheckAggregates.minLatencyMs}, ${minLatencyMs}), ${minLatencyMs})`,
          maxLatencyMs:
            maxLatencyMs === undefined
              ? sql`${healthCheckAggregates.maxLatencyMs}`
              : sql`GREATEST(COALESCE(${healthCheckAggregates.maxLatencyMs}, ${maxLatencyMs}), ${maxLatencyMs})`,
          p95LatencyMs:
            p95LatencyMs === undefined
              ? sql`${healthCheckAggregates.p95LatencyMs}`
              : sql`GREATEST(COALESCE(${healthCheckAggregates.p95LatencyMs}, ${p95LatencyMs}), ${p95LatencyMs})`,
        },
      });

    // Delete processed hourly aggregates
    for (const hourly of bucket.aggregates) {
      await db
        .delete(healthCheckAggregates)
        .where(eq(healthCheckAggregates.id, hourly.id));
    }
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
