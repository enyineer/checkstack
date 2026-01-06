import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {
  healthCheckRuns,
  systemHealthChecks,
  healthCheckAggregates,
  DEFAULT_RETENTION_CONFIG,
} from "./schema";
import { eq, and, lt, sql } from "drizzle-orm";
import type {
  HealthCheckRegistry,
  Logger,
} from "@checkmate-monitor/backend-api";
import type { QueueManager } from "@checkmate-monitor/queue-api";

type Db = NodePgDatabase<typeof schema>;

interface RetentionJobDeps {
  db: Db;
  registry: HealthCheckRegistry;
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
  const { queueManager, logger, db, registry } = deps;

  const queue = queueManager.getQueue<RetentionJobPayload>(RETENTION_QUEUE);

  // Register consumer for retention jobs
  await queue.consume(
    async () => {
      logger.info("Starting health check retention job");
      await runRetentionJob({ db, registry, logger, queueManager });
      logger.info("Completed health check retention job");
    },
    { consumerGroup: "retention-worker" }
  );

  // Schedule daily retention run (86400 seconds = 24 hours)
  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: "health-check-retention-daily",
      intervalSeconds: 24 * 60 * 60, // Daily (24 hours)
    }
  );

  logger.info("Health check retention job scheduled (runs daily)");
}

/**
 * Main retention job logic
 */
export async function runRetentionJob(deps: RetentionJobDeps) {
  const { db, registry, logger } = deps;

  // Get all unique system-config assignments
  const assignments = await db.select().from(systemHealthChecks);

  for (const assignment of assignments) {
    const retentionConfig =
      assignment.retentionConfig ?? DEFAULT_RETENTION_CONFIG;

    try {
      // 1. Aggregate old raw runs into hourly buckets
      await aggregateRawRuns({
        db,
        registry,
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
        { error }
      );
    }
  }
}

interface AggregateRawRunsParams {
  db: Db;
  registry: HealthCheckRegistry;
  systemId: string;
  configurationId: string;
  rawRetentionDays: number;
}

/**
 * Aggregates raw runs older than retention period into hourly buckets
 */
async function aggregateRawRuns(params: AggregateRawRunsParams) {
  const { db, registry, systemId, configurationId, rawRetentionDays } = params;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rawRetentionDays);
  cutoffDate.setHours(cutoffDate.getHours(), 0, 0, 0); // Round to hour

  // Get strategy for metadata aggregation
  const config = await db.query.healthCheckConfigurations.findFirst({
    where: eq(schema.healthCheckConfigurations.id, configurationId),
  });
  const strategy = config ? registry.getStrategy(config.strategyId) : undefined;

  // Query raw runs older than cutoff, grouped by hour
  const oldRuns = await db
    .select()
    .from(healthCheckRuns)
    .where(
      and(
        eq(healthCheckRuns.systemId, systemId),
        eq(healthCheckRuns.configurationId, configurationId),
        lt(healthCheckRuns.timestamp, cutoffDate)
      )
    )
    .orderBy(healthCheckRuns.timestamp);

  if (oldRuns.length === 0) return;

  // Group into hourly buckets
  const buckets = new Map<
    string,
    {
      bucketStart: Date;
      runs: Array<{
        status: "healthy" | "unhealthy" | "degraded";
        latencyMs: number | undefined;
        metadata?: Record<string, unknown>;
      }>;
      runIds: string[];
    }
  >();

  for (const run of oldRuns) {
    const bucketStart = new Date(run.timestamp);
    bucketStart.setMinutes(0, 0, 0);
    const key = bucketStart.toISOString();

    if (!buckets.has(key)) {
      buckets.set(key, { bucketStart, runs: [], runIds: [] });
    }
    const bucket = buckets.get(key)!;
    bucket.runs.push({
      status: run.status,
      latencyMs: run.latencyMs ?? undefined,
      metadata: run.result ?? undefined,
    });
    bucket.runIds.push(run.id);
  }

  // Create aggregates and delete raw runs
  for (const [, bucket] of buckets) {
    // Calculate metrics
    const runCount = bucket.runs.length;
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    for (const r of bucket.runs) {
      if (r.status === "healthy") healthyCount++;
      if (r.status === "degraded") degradedCount++;
      if (r.status === "unhealthy") unhealthyCount++;
    }

    const latencies = bucket.runs
      .map((r) => r.latencyMs)
      .filter((l): l is number => l !== undefined);

    let avgLatencyMs: number | undefined;
    let minLatencyMs: number | undefined;
    let maxLatencyMs: number | undefined;
    let p95LatencyMs: number | undefined;

    if (latencies.length > 0) {
      let sum = 0;
      for (const l of latencies) sum += l;
      avgLatencyMs = Math.round(sum / latencies.length);
      minLatencyMs = Math.min(...latencies);
      maxLatencyMs = Math.max(...latencies);
      p95LatencyMs = calculatePercentile(latencies, 95);
    }

    // Aggregate result if strategy is available
    let aggregatedResult: Record<string, unknown> | undefined;
    if (strategy) {
      aggregatedResult = strategy.aggregateResult(bucket.runs) as Record<
        string,
        unknown
      >;
    }

    // Insert or update aggregate
    await db
      .insert(healthCheckAggregates)
      .values({
        configurationId,
        systemId,
        bucketStart: bucket.bucketStart,
        bucketSize: "hourly",
        runCount,
        healthyCount,
        degradedCount,
        unhealthyCount,
        avgLatencyMs,
        minLatencyMs,
        maxLatencyMs,
        p95LatencyMs,
        aggregatedResult,
      })
      .onConflictDoUpdate({
        target: [
          healthCheckAggregates.configurationId,
          healthCheckAggregates.systemId,
          healthCheckAggregates.bucketStart,
          healthCheckAggregates.bucketSize,
        ],
        set: {
          runCount: sql`${healthCheckAggregates.runCount} + ${runCount}`,
          healthyCount: sql`${healthCheckAggregates.healthyCount} + ${healthyCount}`,
          degradedCount: sql`${healthCheckAggregates.degradedCount} + ${degradedCount}`,
          unhealthyCount: sql`${healthCheckAggregates.unhealthyCount} + ${unhealthyCount}`,
        },
      });

    // Delete processed raw runs
    for (const runId of bucket.runIds) {
      await db.delete(healthCheckRuns).where(eq(healthCheckRuns.id, runId));
    }
  }
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
        lt(healthCheckAggregates.bucketStart, cutoffDate)
      )
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
    let totalWeightedLatency = 0;

    for (const a of bucket.aggregates) {
      runCount += a.runCount;
      healthyCount += a.healthyCount;
      degradedCount += a.degradedCount;
      unhealthyCount += a.unhealthyCount;
      if (a.avgLatencyMs !== null) {
        totalWeightedLatency += a.avgLatencyMs * a.runCount;
      }
    }

    const avgLatencyMs =
      runCount > 0 ? Math.round(totalWeightedLatency / runCount) : undefined;

    // Min/max across all hourly buckets
    const minValues = bucket.aggregates
      .map((a) => a.minLatencyMs)
      .filter((v): v is number => v !== null);
    const maxValues = bucket.aggregates
      .map((a) => a.maxLatencyMs)
      .filter((v): v is number => v !== null);
    const minLatencyMs =
      minValues.length > 0 ? Math.min(...minValues) : undefined;
    const maxLatencyMs =
      maxValues.length > 0 ? Math.max(...maxValues) : undefined;

    // Insert daily aggregate
    await db.insert(healthCheckAggregates).values({
      configurationId,
      systemId,
      bucketStart: bucket.bucketStart,
      bucketSize: "daily",
      runCount,
      healthyCount,
      degradedCount,
      unhealthyCount,
      avgLatencyMs,
      minLatencyMs,
      maxLatencyMs,
      p95LatencyMs: undefined, // Cannot accurately combine p95s
      aggregatedResult: undefined, // Cannot combine result across hours
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
        lt(healthCheckAggregates.bucketStart, cutoffDate)
      )
    );
}

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
