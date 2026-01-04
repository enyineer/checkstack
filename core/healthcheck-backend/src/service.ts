import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  StateThresholds,
  HealthCheckStatus,
  RetentionConfig,
} from "@checkmate/healthcheck-common";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
  VersionedStateThresholds,
} from "./schema";
import * as schema from "./schema";
import { eq, and, InferSelectModel, desc, gte, lte } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ORPCError } from "@orpc/server";
import { evaluateHealthStatus } from "./state-evaluator";
import { stateThresholds } from "./state-thresholds-migrations";
import type { HealthCheckRegistry } from "@checkmate/backend-api";

// Drizzle type helper
type Db = NodePgDatabase<typeof schema>;

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
  constructor(private db: Db, private registry?: HealthCheckRegistry) {}

  async createConfiguration(
    data: CreateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration> {
    const [config] = await this.db
      .insert(healthCheckConfigurations)
      .values({
        name: data.name,
        strategyId: data.strategyId,
        config: data.config,
        intervalSeconds: data.intervalSeconds,
        isTemplate: false, // Defaulting for now
      })
      .returning();
    return this.mapConfig(config);
  }

  async getConfiguration(
    id: string
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
    return config ? this.mapConfig(config) : undefined;
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration
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
          eq(systemHealthChecks.configurationId, configurationId)
        )
      );
  }

  /**
   * Get retention configuration for a health check assignment.
   */
  async getRetentionConfig(
    systemId: string,
    configurationId: string
  ): Promise<{ retentionConfig: RetentionConfig | null }> {
    const row = await this.db
      .select({ retentionConfig: systemHealthChecks.retentionConfig })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId)
        )
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
    retentionConfig: RetentionConfig | null
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
          eq(systemHealthChecks.configurationId, configurationId)
        )
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
    systemId: string
  ): Promise<HealthCheckConfiguration[]> {
    const rows = await this.db
      .select({
        config: healthCheckConfigurations,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
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
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
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
    systemId: string
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
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.enabled, true)
        )
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
            eq(healthCheckRuns.configurationId, assoc.configurationId)
          )
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
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    const checks = [];
    const sparklineLimit = 25;

    for (const assoc of associations) {
      // Get last 25 runs for sparkline
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
            eq(healthCheckRuns.configurationId, assoc.configurationId)
          )
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(sparklineLimit);

      // Migrate and extract thresholds
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      // Evaluate current status
      const status = evaluateHealthStatus({
        runs: runs as Array<{ status: HealthCheckStatus; timestamp: Date }>,
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
        recentRuns: runs.map((r) => ({
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
   */
  async getHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      limit = 10,
      offset = 0,
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

    // Get paginated runs
    let query = this.db.select().from(healthCheckRuns);
    if (whereClause) {
      // @ts-expect-error drizzle-orm type mismatch
      query = query.where(whereClause);
    }
    const runs = await query
      .orderBy(desc(healthCheckRuns.timestamp))
      .limit(limit)
      .offset(offset);

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
   * Restricted to users with manage permission.
   */
  async getDetailedHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      limit = 10,
      offset = 0,
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
    const runs = await query
      .orderBy(desc(healthCheckRuns.timestamp))
      .limit(limit)
      .offset(offset);

    // Return with full result data for manage permission
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
   * Get aggregated health check history with bucketed metrics.
   * Currently aggregates raw data on-the-fly. Will merge with stored aggregates
   * once the retention job populates historical data.
   */
  async getAggregatedHistory(
    props: {
      systemId: string;
      configurationId: string;
      startDate: Date;
      endDate: Date;
      bucketSize: "hourly" | "daily" | "auto";
    },
    options: { includeAggregatedResult: boolean }
  ) {
    const { systemId, configurationId, startDate, endDate } = props;
    let bucketSize = props.bucketSize;

    // Auto-select bucket size based on range
    if (bucketSize === "auto") {
      const diffDays =
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      bucketSize = diffDays > 7 ? "daily" : "hourly";
    }

    // Get the configuration to find the strategy
    const config = await this.db.query.healthCheckConfigurations.findFirst({
      where: eq(healthCheckConfigurations.id, configurationId),
    });

    // Look up strategy for aggregateResult function (only if needed)
    const strategy =
      options.includeAggregatedResult && config && this.registry
        ? this.registry.getStrategy(config.strategyId)
        : undefined;

    // Query raw runs within the date range (including result for metadata)
    const runs = await this.db
      .select()
      .from(healthCheckRuns)
      .where(
        and(
          eq(healthCheckRuns.systemId, systemId),
          eq(healthCheckRuns.configurationId, configurationId),
          gte(healthCheckRuns.timestamp, startDate),
          lte(healthCheckRuns.timestamp, endDate)
        )
      )
      .orderBy(healthCheckRuns.timestamp);

    // Group runs into buckets (with full result for metadata aggregation)
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
      const bucketStart = this.getBucketStart(run.timestamp, bucketSize);
      const key = bucketStart.toISOString();

      if (!bucketMap.has(key)) {
        bucketMap.set(key, { bucketStart, runs: [] });
      }
      bucketMap.get(key)!.runs.push({
        status: run.status,
        latencyMs: run.latencyMs ?? undefined,
        metadata: run.result ?? undefined,
      });
    }

    // Calculate metrics for each bucket
    const buckets = [...bucketMap.values()].map((bucket) => {
      const runCount = bucket.runs.length;
      const healthyCount = bucket.runs.filter(
        (r) => r.status === "healthy"
      ).length;
      const degradedCount = bucket.runs.filter(
        (r) => r.status === "degraded"
      ).length;
      const unhealthyCount = bucket.runs.filter(
        (r) => r.status === "unhealthy"
      ).length;
      const successRate = runCount > 0 ? healthyCount / runCount : 0;

      const latencies = bucket.runs
        .map((r) => r.latencyMs)
        .filter((l): l is number => l !== null);
      const avgLatencyMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : undefined;
      const minLatencyMs =
        latencies.length > 0 ? Math.min(...latencies) : undefined;
      const maxLatencyMs =
        latencies.length > 0 ? Math.max(...latencies) : undefined;
      const p95LatencyMs =
        latencies.length > 0
          ? this.calculatePercentile(latencies, 95)
          : undefined;

      // Build base bucket (always included)
      const baseBucket = {
        bucketStart: bucket.bucketStart,
        bucketSize: bucketSize as "hourly" | "daily",
        runCount,
        healthyCount,
        degradedCount,
        unhealthyCount,
        successRate,
        avgLatencyMs,
        minLatencyMs,
        maxLatencyMs,
        p95LatencyMs,
      };

      // Only include aggregatedResult if requested and strategy is available
      if (options.includeAggregatedResult && strategy) {
        return {
          ...baseBucket,
          aggregatedResult: strategy.aggregateResult(bucket.runs) as Record<
            string,
            unknown
          >,
        };
      }

      return baseBucket;
    });

    return { buckets };
  }

  private getBucketStart(
    timestamp: Date,
    bucketSize: "hourly" | "daily"
  ): Date {
    const date = new Date(timestamp);
    if (bucketSize === "daily") {
      date.setHours(0, 0, 0, 0);
    } else {
      date.setMinutes(0, 0, 0);
    }
    return date;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.toSorted((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private mapConfig(
    row: InferSelectModel<typeof healthCheckConfigurations>
  ): HealthCheckConfiguration {
    return {
      id: row.id,
      name: row.name,
      strategyId: row.strategyId,
      config: row.config,
      intervalSeconds: row.intervalSeconds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
