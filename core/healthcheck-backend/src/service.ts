import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  StateThresholds,
  HealthCheckStatus,
  RetentionConfig,
} from "@checkstack/healthcheck-common";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
  healthCheckAggregates,
  VersionedStateThresholds,
} from "./schema";
import * as schema from "./schema";
import { eq, and, InferSelectModel, desc, gte, lte } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { evaluateHealthStatus } from "./state-evaluator";
import { stateThresholds } from "./state-thresholds-migrations";
import type {
  HealthCheckRegistry,
  SafeDatabase,
  CollectorRegistry,
} from "@checkstack/backend-api";
import {
  aggregateCollectorData,
  extractLatencies,
  mergeTieredBuckets,
  reaggregateBuckets,
  countStatuses,
  calculateLatencyStats,
  type NormalizedBucket,
} from "./aggregation-utils";

// Drizzle type helper - uses SafeDatabase to prevent relational query API usage
type Db = SafeDatabase<typeof schema>;

interface SystemCheckStatus {
  configurationId: string;
  configurationName: string;
  status: HealthCheckStatus;
  runsConsidered: number;
  lastRunAt?: Date;
}

interface SystemHealthStatusResponse {
  status: HealthCheckStatus;
  evaluatedAt: Date;
  checkStatuses: SystemCheckStatus[];
}

export class HealthCheckService {
  constructor(
    private db: Db,
    private registry?: HealthCheckRegistry,
    private collectorRegistry?: CollectorRegistry,
  ) {}

  async createConfiguration(
    data: CreateHealthCheckConfiguration,
  ): Promise<HealthCheckConfiguration> {
    const [config] = await this.db
      .insert(healthCheckConfigurations)
      .values({
        name: data.name,
        strategyId: data.strategyId,
        config: data.config,
        collectors: data.collectors ?? undefined,
        intervalSeconds: data.intervalSeconds,
        isTemplate: false, // Defaulting for now
      })
      .returning();
    return this.mapConfig(config);
  }

  async getConfiguration(
    id: string,
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
    return config ? this.mapConfig(config) : undefined;
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration,
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .update(healthCheckConfigurations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(healthCheckConfigurations.id, id))
      .returning();
    return config ? this.mapConfig(config) : undefined;
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.db
      .delete(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
  }

  async pauseConfiguration(id: string): Promise<void> {
    await this.db
      .update(healthCheckConfigurations)
      .set({ paused: true, updatedAt: new Date() })
      .where(eq(healthCheckConfigurations.id, id));
  }

  async resumeConfiguration(id: string): Promise<void> {
    await this.db
      .update(healthCheckConfigurations)
      .set({ paused: false, updatedAt: new Date() })
      .where(eq(healthCheckConfigurations.id, id));
  }

  async getConfigurations(): Promise<HealthCheckConfiguration[]> {
    const configs = await this.db.select().from(healthCheckConfigurations);
    return configs.map((c) => this.mapConfig(c));
  }

  async associateSystem(props: {
    systemId: string;
    configurationId: string;
    enabled?: boolean;
    stateThresholds?: StateThresholds;
  }) {
    const {
      systemId,
      configurationId,
      enabled = true,
      stateThresholds: stateThresholds_,
    } = props;

    // Wrap thresholds in versioned config if provided
    const versionedThresholds: VersionedStateThresholds | undefined =
      stateThresholds_ ? stateThresholds.create(stateThresholds_) : undefined;

    await this.db
      .insert(systemHealthChecks)
      .values({
        systemId,
        configurationId,
        enabled,
        stateThresholds: versionedThresholds,
      })
      .onConflictDoUpdate({
        target: [
          systemHealthChecks.systemId,
          systemHealthChecks.configurationId,
        ],
        set: {
          enabled,
          stateThresholds: versionedThresholds,
          updatedAt: new Date(),
        },
      });
  }

  async disassociateSystem(systemId: string, configurationId: string) {
    await this.db
      .delete(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      );
  }

  /**
   * Get retention configuration for a health check assignment.
   */
  async getRetentionConfig(
    systemId: string,
    configurationId: string,
  ): Promise<{ retentionConfig: RetentionConfig | null }> {
    const row = await this.db
      .select({ retentionConfig: systemHealthChecks.retentionConfig })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      )
      .then((rows) => rows[0]);

    // eslint-disable-next-line unicorn/no-null -- RPC contract uses nullable()
    return { retentionConfig: row?.retentionConfig ?? null };
  }

  /**
   * Update retention configuration for a health check assignment.
   */
  async updateRetentionConfig(
    systemId: string,
    configurationId: string,
    retentionConfig: RetentionConfig | null,
  ): Promise<void> {
    // Validate retention hierarchy: raw < hourly < daily
    if (retentionConfig) {
      if (
        retentionConfig.rawRetentionDays >= retentionConfig.hourlyRetentionDays
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Raw retention must be less than hourly retention",
        });
      }
      if (
        retentionConfig.hourlyRetentionDays >=
        retentionConfig.dailyRetentionDays
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Hourly retention must be less than daily retention",
        });
      }
    }

    await this.db
      .update(systemHealthChecks)
      .set({ retentionConfig, updatedAt: new Date() })
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      );
  }

  /**
   * Remove all health check associations for a system.
   * Called when a system is deleted from the catalog.
   */
  async removeAllSystemAssociations(systemId: string) {
    await this.db
      .delete(systemHealthChecks)
      .where(eq(systemHealthChecks.systemId, systemId));
  }

  async getSystemConfigurations(
    systemId: string,
  ): Promise<HealthCheckConfiguration[]> {
    const rows = await this.db
      .select({
        config: healthCheckConfigurations,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    return rows.map((r) => this.mapConfig(r.config));
  }

  /**
   * Get system associations with their threshold configurations.
   */
  async getSystemAssociations(systemId: string) {
    const rows = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
        stateThresholds: systemHealthChecks.stateThresholds,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    // Migrate and extract thresholds for each association
    const results = [];
    for (const row of rows) {
      let thresholds: StateThresholds | undefined;
      if (row.stateThresholds) {
        thresholds = await stateThresholds.parse(row.stateThresholds);
      }
      results.push({
        configurationId: row.configurationId,
        configurationName: row.configName,
        enabled: row.enabled,
        stateThresholds: thresholds,
      });
    }
    return results;
  }

  /**
   * Get the evaluated health status for a system based on configured thresholds.
   * Aggregates status from all health check configurations for this system.
   */
  async getSystemHealthStatus(
    systemId: string,
  ): Promise<SystemHealthStatusResponse> {
    // Get all associations for this system with their thresholds and config names
    const associations = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        stateThresholds: systemHealthChecks.stateThresholds,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.enabled, true),
        ),
      );

    if (associations.length === 0) {
      // No health checks configured - default healthy
      return {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [],
      };
    }

    // For each association, get recent runs and evaluate status
    const checkStatuses: SystemCheckStatus[] = [];
    const maxWindowSize = 100; // Max configurable window size

    for (const assoc of associations) {
      const runs = await this.db
        .select({
          status: healthCheckRuns.status,
          timestamp: healthCheckRuns.timestamp,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId),
          ),
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(maxWindowSize);

      // Extract and migrate thresholds from versioned config
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      const status = evaluateHealthStatus({ runs, thresholds });

      checkStatuses.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        status,
        runsConsidered: runs.length,
        lastRunAt: runs[0]?.timestamp,
      });
    }

    // Aggregate status: worst status wins (unhealthy > degraded > healthy)
    let aggregateStatus: HealthCheckStatus = "healthy";
    for (const cs of checkStatuses) {
      if (cs.status === "unhealthy") {
        aggregateStatus = "unhealthy";
        break; // Can't get worse
      }
      if (cs.status === "degraded") {
        aggregateStatus = "degraded";
        // Don't break - keep looking for unhealthy
      }
    }

    return {
      status: aggregateStatus,
      evaluatedAt: new Date(),
      checkStatuses,
    };
  }

  /**
   * Get comprehensive health overview for a system.
   * Returns all health checks with their last 25 runs for sparkline visualization.
   */
  async getSystemHealthOverview(systemId: string) {
    // Get all associations with config details
    const associations = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        configName: healthCheckConfigurations.name,
        strategyId: healthCheckConfigurations.strategyId,
        intervalSeconds: healthCheckConfigurations.intervalSeconds,
        enabled: systemHealthChecks.enabled,
        stateThresholds: systemHealthChecks.stateThresholds,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    const checks = [];
    const sparklineLimit = 25;

    for (const assoc of associations) {
      // Get last 25 runs for sparkline (newest first, then reverse for chronological display)
      const runs = await this.db
        .select({
          id: healthCheckRuns.id,
          status: healthCheckRuns.status,
          timestamp: healthCheckRuns.timestamp,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId),
          ),
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(sparklineLimit);

      // Reverse to chronological order (oldest first) for sparkline display
      const chronologicalRuns = runs.toReversed();

      // Migrate and extract thresholds
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      // Evaluate current status (runs are in DESC order - newest first - as evaluateHealthStatus expects)
      const status = evaluateHealthStatus({
        runs,
        thresholds,
      });

      checks.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        strategyId: assoc.strategyId,
        intervalSeconds: assoc.intervalSeconds,
        enabled: assoc.enabled,
        status,
        stateThresholds: thresholds,
        recentRuns: chronologicalRuns.map((r) => ({
          id: r.id,
          status: r.status,
          timestamp: r.timestamp,
        })),
      });
    }

    return { systemId, checks };
  }

  /**
   * Get paginated health check run history (public - no result data).
   * @param sortOrder - 'asc' for chronological (oldest first), 'desc' for reverse (newest first)
   */
  async getHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
    sortOrder: "asc" | "desc";
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      limit = 10,
      offset = 0,
      sortOrder,
    } = props;

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (startDate) conditions.push(gte(healthCheckRuns.timestamp, startDate));
    if (endDate) conditions.push(lte(healthCheckRuns.timestamp, endDate));

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count using drizzle $count
    const total = await this.db.$count(healthCheckRuns, whereClause);

    // Get paginated runs with requested sort order
    let query = this.db.select().from(healthCheckRuns);
    if (whereClause) {
      // @ts-expect-error drizzle-orm type mismatch
      query = query.where(whereClause);
    }
    const orderColumn =
      sortOrder === "desc"
        ? desc(healthCheckRuns.timestamp)
        : healthCheckRuns.timestamp;
    const runs = await query.orderBy(orderColumn).limit(limit).offset(offset);

    // Return without result field for public access (latencyMs is public data)
    return {
      runs: runs.map((run) => ({
        id: run.id,
        configurationId: run.configurationId,
        systemId: run.systemId,
        status: run.status,
        timestamp: run.timestamp,
        latencyMs: run.latencyMs ?? undefined,
      })),
      total,
    };
  }

  /**
   * Get detailed health check run history with full result data.
   * Restricted to users with manage access.
   * @param sortOrder - 'asc' for chronological (oldest first), 'desc' for reverse (newest first)
   */
  async getDetailedHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
    sortOrder: "asc" | "desc";
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      limit = 10,
      offset = 0,
      sortOrder,
    } = props;

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (startDate) conditions.push(gte(healthCheckRuns.timestamp, startDate));
    if (endDate) conditions.push(lte(healthCheckRuns.timestamp, endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const total = await this.db.$count(healthCheckRuns, whereClause);

    let query = this.db.select().from(healthCheckRuns);
    if (whereClause) {
      // @ts-expect-error drizzle-orm type mismatch
      query = query.where(whereClause);
    }
    const orderColumn =
      sortOrder === "desc"
        ? desc(healthCheckRuns.timestamp)
        : healthCheckRuns.timestamp;
    const runs = await query.orderBy(orderColumn).limit(limit).offset(offset);

    // Return with full result data for manage access
    return {
      runs: runs.map((run) => ({
        id: run.id,
        configurationId: run.configurationId,
        systemId: run.systemId,
        status: run.status,
        result: run.result ?? {},
        timestamp: run.timestamp,
        latencyMs: run.latencyMs ?? undefined,
      })),
      total,
    };
  }

  /**
   * Get a single health check run by its ID.
   */
  async getRunById(props: { runId: string }) {
    const run = await this.db
      .select()
      .from(healthCheckRuns)
      .where(eq(healthCheckRuns.id, props.runId))
      .limit(1);

    if (run.length === 0) {
      return;
    }

    const r = run[0];
    return {
      id: r.id,
      configurationId: r.configurationId,
      systemId: r.systemId,
      status: r.status,
      result: r.result ?? {},
      timestamp: r.timestamp,
      latencyMs: r.latencyMs ?? undefined,
    };
  }

  /**
   * Get aggregated health check history with dynamically-sized buckets.
   * Queries all three tiers (raw, hourly, daily) and merges with priority.
   * Bucket interval is calculated as (endDate - startDate) / targetPoints.
   */
  async getAggregatedHistory(
    props: {
      systemId: string;
      configurationId: string;
      startDate: Date;
      endDate: Date;
      targetPoints?: number;
    },
    options: { includeAggregatedResult: boolean },
  ) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      targetPoints = 500,
    } = props;

    // Calculate dynamic bucket interval
    const rangeMs = endDate.getTime() - startDate.getTime();
    const MIN_INTERVAL_MS = 1000; // 1 second minimum
    const bucketIntervalMs = Math.max(rangeMs / targetPoints, MIN_INTERVAL_MS);
    const bucketIntervalSeconds = Math.round(bucketIntervalMs / 1000);

    // Get the configuration to find the strategy
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, configurationId))
      .limit(1);

    // Look up strategy for aggregateResult function (only if needed)
    const strategy =
      options.includeAggregatedResult && config && this.registry
        ? this.registry.getStrategy(config.strategyId)
        : undefined;

    // Query all three tiers in parallel
    const [rawRuns, hourlyAggregates, dailyAggregates] = await Promise.all([
      // Raw runs
      this.db
        .select()
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, configurationId),
            gte(healthCheckRuns.timestamp, startDate),
            lte(healthCheckRuns.timestamp, endDate),
          ),
        )
        .orderBy(healthCheckRuns.timestamp),
      // Hourly aggregates
      this.db
        .select()
        .from(healthCheckAggregates)
        .where(
          and(
            eq(healthCheckAggregates.systemId, systemId),
            eq(healthCheckAggregates.configurationId, configurationId),
            eq(healthCheckAggregates.bucketSize, "hourly"),
            gte(healthCheckAggregates.bucketStart, startDate),
            lte(healthCheckAggregates.bucketStart, endDate),
          ),
        )
        .orderBy(healthCheckAggregates.bucketStart),
      // Daily aggregates
      this.db
        .select()
        .from(healthCheckAggregates)
        .where(
          and(
            eq(healthCheckAggregates.systemId, systemId),
            eq(healthCheckAggregates.configurationId, configurationId),
            eq(healthCheckAggregates.bucketSize, "daily"),
            gte(healthCheckAggregates.bucketStart, startDate),
            lte(healthCheckAggregates.bucketStart, endDate),
          ),
        )
        .orderBy(healthCheckAggregates.bucketStart),
    ]);

    // Normalize raw runs to buckets using target interval for proper aggregation
    // This ensures aggregatedResult is computed per target bucket, not per sub-bucket
    const rawBuckets = this.normalizeRawRunsToBuckets({
      runs: rawRuns,
      bucketIntervalMs: bucketIntervalMs,
      rangeStart: startDate,
      strategy,
    });

    // Normalize hourly and daily aggregates to NormalizedBucket format
    const HOURLY_MS = 60 * 60 * 1000;
    const DAILY_MS = 24 * 60 * 60 * 1000;

    const hourlyBuckets: NormalizedBucket[] = hourlyAggregates.map((agg) => ({
      bucketStart: agg.bucketStart,
      bucketEndMs: agg.bucketStart.getTime() + HOURLY_MS,
      runCount: agg.runCount,
      healthyCount: agg.healthyCount,
      degradedCount: agg.degradedCount,
      unhealthyCount: agg.unhealthyCount,
      latencySumMs: agg.latencySumMs ?? undefined,
      minLatencyMs: agg.minLatencyMs ?? undefined,
      maxLatencyMs: agg.maxLatencyMs ?? undefined,
      p95LatencyMs: agg.p95LatencyMs ?? undefined,
      aggregatedResult: agg.aggregatedResult ?? undefined,
      sourceTier: "hourly" as const,
    }));

    const dailyBuckets: NormalizedBucket[] = dailyAggregates.map((agg) => ({
      bucketStart: agg.bucketStart,
      bucketEndMs: agg.bucketStart.getTime() + DAILY_MS,
      runCount: agg.runCount,
      healthyCount: agg.healthyCount,
      degradedCount: agg.degradedCount,
      unhealthyCount: agg.unhealthyCount,
      latencySumMs: agg.latencySumMs ?? undefined,
      minLatencyMs: agg.minLatencyMs ?? undefined,
      maxLatencyMs: agg.maxLatencyMs ?? undefined,
      p95LatencyMs: agg.p95LatencyMs ?? undefined,
      aggregatedResult: agg.aggregatedResult ?? undefined,
      sourceTier: "daily" as const,
    }));

    // Merge all tiers with priority (raw > hourly > daily)
    const mergedBuckets = mergeTieredBuckets({
      rawBuckets,
      hourlyBuckets,
      dailyBuckets,
    });

    // Re-aggregate to target bucket interval
    const targetBuckets = reaggregateBuckets({
      sourceBuckets: mergedBuckets,
      targetIntervalMs: bucketIntervalMs,
      rangeStart: startDate,
      rangeEnd: endDate,
    });

    // Convert to output format
    const buckets = targetBuckets.map((bucket) => {
      const successRate =
        bucket.runCount > 0 ? bucket.healthyCount / bucket.runCount : 0;
      const avgLatencyMs =
        bucket.latencySumMs !== undefined && bucket.runCount > 0
          ? Math.round(bucket.latencySumMs / bucket.runCount)
          : undefined;

      const baseBucket = {
        bucketStart: bucket.bucketStart,
        bucketEnd: new Date(bucket.bucketEndMs),
        bucketIntervalSeconds,
        runCount: bucket.runCount,
        healthyCount: bucket.healthyCount,
        degradedCount: bucket.degradedCount,
        unhealthyCount: bucket.unhealthyCount,
        successRate,
        avgLatencyMs,
        minLatencyMs: bucket.minLatencyMs,
        maxLatencyMs: bucket.maxLatencyMs,
        p95LatencyMs: bucket.p95LatencyMs,
      };

      // Include aggregatedResult if available (only from raw data)
      if (options.includeAggregatedResult && bucket.aggregatedResult) {
        return {
          ...baseBucket,
          aggregatedResult: bucket.aggregatedResult,
        };
      }

      return baseBucket;
    });

    return { buckets, bucketIntervalSeconds };
  }

  /**
   * Normalize raw runs into buckets for merging with aggregate tiers.
   */
  private normalizeRawRunsToBuckets(params: {
    runs: Array<{
      id: string;
      status: "healthy" | "unhealthy" | "degraded";
      timestamp: Date;
      latencyMs: number | null;
      result: Record<string, unknown> | null;
    }>;
    bucketIntervalMs: number;
    rangeStart: Date;
    strategy?: {
      aggregateResult: (
        runs: Array<{
          status: "healthy" | "unhealthy" | "degraded";
          latencyMs?: number;
          metadata?: unknown;
        }>,
      ) => unknown;
    };
  }): NormalizedBucket[] {
    const { runs, bucketIntervalMs, rangeStart, strategy } = params;

    if (runs.length === 0) {
      return [];
    }

    // Group runs by bucket
    const bucketMap = new Map<
      string,
      {
        bucketStart: Date;
        runs: Array<{
          status: "healthy" | "unhealthy" | "degraded";
          latencyMs: number | undefined;
          metadata?: Record<string, unknown>;
        }>;
      }
    >();

    for (const run of runs) {
      const bucketStart = this.getBucketStartDynamic(
        run.timestamp,
        rangeStart,
        bucketIntervalMs,
      );
      const key = bucketStart.toISOString();

      if (!bucketMap.has(key)) {
        bucketMap.set(key, { bucketStart, runs: [] });
      }

      const storedResult = run.result as {
        metadata?: Record<string, unknown>;
      } | null;

      bucketMap.get(key)!.runs.push({
        status: run.status,
        latencyMs: run.latencyMs ?? undefined,
        metadata: storedResult?.metadata ?? undefined,
      });
    }

    // Convert to NormalizedBucket format
    const result: NormalizedBucket[] = [];

    for (const [, bucket] of bucketMap) {
      const { healthyCount, degradedCount, unhealthyCount } = countStatuses(
        bucket.runs,
      );
      const latencies = extractLatencies(bucket.runs);
      const latencyStats = calculateLatencyStats(latencies);

      // Compute aggregatedResult if strategy is available
      let aggregatedResult: Record<string, unknown> | undefined;
      if (strategy) {
        const strategyResult = strategy.aggregateResult(bucket.runs) as Record<
          string,
          unknown
        >;

        // Aggregate collector data if collector registry is available
        let collectorsAggregated: Record<string, unknown> | undefined;
        if (this.collectorRegistry) {
          collectorsAggregated = aggregateCollectorData(
            bucket.runs,
            this.collectorRegistry,
          );
        }

        aggregatedResult = {
          ...strategyResult,
          ...(collectorsAggregated ? { collectors: collectorsAggregated } : {}),
        };
      }

      result.push({
        bucketStart: bucket.bucketStart,
        bucketEndMs: bucket.bucketStart.getTime() + bucketIntervalMs,
        runCount: bucket.runs.length,
        healthyCount,
        degradedCount,
        unhealthyCount,
        latencySumMs: latencyStats.latencySumMs,
        minLatencyMs: latencyStats.minLatencyMs,
        maxLatencyMs: latencyStats.maxLatencyMs,
        p95LatencyMs: latencyStats.p95LatencyMs,
        aggregatedResult,
        sourceTier: "raw",
      });
    }

    return result;
  }

  /**
   * Calculate bucket start time for dynamic interval sizing.
   * Aligns buckets to the query start time.
   */
  /**
   * Get availability statistics for a health check over 31-day and 365-day periods.
   * Availability is calculated as (healthyCount / totalRunCount) * 100.
   */
  async getAvailabilityStats(props: {
    systemId: string;
    configurationId: string;
  }): Promise<{
    availability31Days: number | null;
    availability365Days: number | null;
    totalRuns31Days: number;
    totalRuns365Days: number;
  }> {
    const { systemId, configurationId } = props;
    const now = new Date();

    // Calculate cutoff dates
    const cutoff31Days = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const cutoff365Days = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Query daily aggregates for the full 365-day period
    const dailyAggregates = await this.db
      .select({
        bucketStart: healthCheckAggregates.bucketStart,
        runCount: healthCheckAggregates.runCount,
        healthyCount: healthCheckAggregates.healthyCount,
      })
      .from(healthCheckAggregates)
      .where(
        and(
          eq(healthCheckAggregates.systemId, systemId),
          eq(healthCheckAggregates.configurationId, configurationId),
          eq(healthCheckAggregates.bucketSize, "daily"),
          gte(healthCheckAggregates.bucketStart, cutoff365Days),
        ),
      );

    // Also query raw runs for the recent period not yet aggregated (typically last 7 days)
    const recentRuns = await this.db
      .select({
        status: healthCheckRuns.status,
        timestamp: healthCheckRuns.timestamp,
      })
      .from(healthCheckRuns)
      .where(
        and(
          eq(healthCheckRuns.systemId, systemId),
          eq(healthCheckRuns.configurationId, configurationId),
          gte(healthCheckRuns.timestamp, cutoff365Days),
        ),
      );

    // Separate data by period
    let totalRuns31Days = 0;
    let healthyRuns31Days = 0;
    let totalRuns365Days = 0;
    let healthyRuns365Days = 0;

    // Process daily aggregates
    for (const agg of dailyAggregates) {
      totalRuns365Days += agg.runCount;
      healthyRuns365Days += agg.healthyCount;

      if (agg.bucketStart >= cutoff31Days) {
        totalRuns31Days += agg.runCount;
        healthyRuns31Days += agg.healthyCount;
      }
    }

    // Process recent raw runs (to include data not yet aggregated)
    // Deduplicate by checking if a run's timestamp falls within an already-counted aggregate bucket
    const aggregateBucketStarts = new Set(
      dailyAggregates.map((a) => a.bucketStart.getTime()),
    );

    for (const run of recentRuns) {
      // Calculate which daily bucket this run would belong to
      const runBucketStart = new Date(run.timestamp);
      runBucketStart.setUTCHours(0, 0, 0, 0);

      // Only count if this bucket isn't already in aggregates
      if (!aggregateBucketStarts.has(runBucketStart.getTime())) {
        totalRuns365Days += 1;
        if (run.status === "healthy") {
          healthyRuns365Days += 1;
        }

        if (run.timestamp >= cutoff31Days) {
          totalRuns31Days += 1;
          if (run.status === "healthy") {
            healthyRuns31Days += 1;
          }
        }
      }
    }

    // Calculate availability percentages
    const availability31Days =
      // eslint-disable-next-line unicorn/no-null -- RPC contract uses nullable()
      totalRuns31Days > 0 ? (healthyRuns31Days / totalRuns31Days) * 100 : null;
    const availability365Days =
      totalRuns365Days > 0
        ? (healthyRuns365Days / totalRuns365Days) * 100
        : // eslint-disable-next-line unicorn/no-null -- RPC contract uses nullable()
          null;

    return {
      availability31Days,
      availability365Days,
      totalRuns31Days,
      totalRuns365Days,
    };
  }

  private getBucketStartDynamic(
    timestamp: Date,
    rangeStart: Date,
    intervalMs: number,
  ): Date {
    const offsetMs = timestamp.getTime() - rangeStart.getTime();
    const bucketIndex = Math.floor(offsetMs / intervalMs);
    return new Date(rangeStart.getTime() + bucketIndex * intervalMs);
  }

  private mapConfig(
    row: InferSelectModel<typeof healthCheckConfigurations>,
  ): HealthCheckConfiguration {
    return {
      id: row.id,
      name: row.name,
      strategyId: row.strategyId,
      config: row.config,
      collectors: row.collectors ?? undefined,
      intervalSeconds: row.intervalSeconds,
      paused: row.paused,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
