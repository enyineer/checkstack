import {
  pgTable,
  pgEnum,
  text,
  jsonb,
  integer,
  boolean,
  uuid,
  timestamp,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";
import type {
  StateThresholds,
  CollectorConfigEntry,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import type { VersionedRecord } from "@checkstack/backend-api";

/**
 * Type alias for versioned state thresholds stored in the database.
 * Uses VersionedRecord generic base for migration support.
 */
export type VersionedStateThresholds = VersionedRecord<StateThresholds>;

/**
 * Health check status enum for type-safe status values.
 */
export const healthCheckStatusEnum = pgEnum("health_check_status", [
  "healthy",
  "unhealthy",
  "degraded",
]);

export type HealthCheckStatus =
  (typeof healthCheckStatusEnum.enumValues)[number];

export const healthCheckConfigurations = pgTable(
  "health_check_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    strategyId: text("strategy_id").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    /** Collector configurations for this health check */
    collectors: jsonb("collectors").$type<CollectorConfigEntry[]>(),
    intervalSeconds: integer("interval_seconds").notNull(),
    isTemplate: boolean("is_template").default(false),
    /** Whether this configuration is paused (execution skipped for all systems) */
    paused: boolean("paused").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

/**
 * Retention configuration for health check data.
 * Defines how long raw runs and aggregates are kept.
 */
export interface RetentionConfig {
  /** Days to keep raw run data before aggregating (default: 7) */
  rawRetentionDays: number;
  /** Days to keep hourly aggregates before rolling to daily (default: 30) */
  hourlyRetentionDays: number;
  /** Days to keep daily aggregates before deleting (default: 365) */
  dailyRetentionDays: number;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  rawRetentionDays: 7,
  hourlyRetentionDays: 30,
  dailyRetentionDays: 365,
};

export const systemHealthChecks = pgTable(
  "system_health_checks",
  {
    systemId: text("system_id").notNull(),
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    /**
     * State thresholds for evaluating health status.
     * Versioned to allow schema evolution without migrations for existing rows.
     */
    stateThresholds:
      jsonb("state_thresholds").$type<VersionedStateThresholds>(),
    /**
     * Retention configuration for this health check assignment.
     * Null means use default retention settings.
     */
    retentionConfig: jsonb("retention_config").$type<RetentionConfig>(),
    /**
     * IDs of satellites assigned to execute this health check.
     * When set, the check runs on these satellite nodes in addition to (or instead of) the core.
     */
    satelliteIds: jsonb("satellite_ids").$type<string[]>(),
    /**
     * Per-assignment environment selector for per-environment fan-out.
     *
     * Semantics (null vs [] are SEMANTICALLY DISTINCT here, unlike most
     * nullable jsonb in this schema):
     * - `null`  => all environments the system currently belongs to.
     * - `[]`    => opt out: run ONCE with no environment in context.
     * - non-empty => exactly those environment ids, intersected with the
     *   system's current membership (a removed env silently drops out).
     *
     * The service distinguishes `row.environmentIds === null` from
     * `length === 0`; jsonb stores both faithfully.
     */
    environmentIds: jsonb("environment_ids").$type<string[]>(),
    /**
     * Whether to also run this check locally on the core instance.
     * Defaults to true. Only relevant when satelliteIds is set.
     */
    includeLocal: boolean("include_local").default(true).notNull(),
    /**
     * Per-association notification policy. Null falls back to platform
     * defaults (no suppression).
     */
    notificationPolicy:
      jsonb("notification_policy").$type<NotificationPolicy>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.systemId, t.configurationId] }),
  }),
);

/**
 * Records every *aggregate* health-status transition for a system
 * (e.g. healthy -> degraded -> unhealthy -> healthy). This table is
 * unconditional and covers ALL statuses, giving a reliable
 * "in current status since" timestamp for arbitrary statuses.
 *
 * The former `health_check_unhealthy_transitions` table (per-check,
 * unhealthy-only) was dropped: flapping is now counted in the automation
 * engine's `automation_window_events` log via the windowed-count gate on the
 * `system_health_changed` trigger, so healthcheck no longer keeps a separate
 * transition audit for flapping.
 *
 * One row is written per aggregate transition at the same point the
 * `systemHealthChanged` hook fires. `configurationId` is the check that
 * drove the transition (the just-ran check).
 *
 * Retention: pruned alongside raw runs, EXCEPT the single most-recent
 * row per system is always kept so "in status since" never blanks for
 * an active streak.
 */
export const healthCheckStateTransitions = pgTable(
  "health_check_state_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: text("system_id").notNull(),
    /** The check whose run drove this aggregate transition. */
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
    /**
     * Environment this transition belongs to. null = a transition recorded
     * for an env-less run (the opt-out / no-membership case). Per-environment
     * transitions stay distinct so "in status since" is env-scoped.
     */
    environmentId: text("environment_id"),
    fromStatus: healthCheckStatusEnum("from_status"),
    toStatus: healthCheckStatusEnum("to_status").notNull(),
    transitionedAt: timestamp("transitioned_at").defaultNow().notNull(),
  },
  (t) => ({
    // Powers "most recent transition into status X for this system+env"
    // (WHERE system_id = ? AND environment_id = ? AND to_status = ?
    //  ORDER BY transitioned_at DESC).
    lookupIdx: index("health_check_state_transitions_lookup_idx").on(
      t.systemId,
      t.environmentId,
      t.toStatus,
      t.transitionedAt,
    ),
    // Powers the retention "keep newest per system+env" sweep.
    systemRecentIdx: index(
      "health_check_state_transitions_system_recent_idx",
    ).on(t.systemId, t.environmentId, t.transitionedAt),
  }),
);

export const healthCheckRuns = pgTable("health_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id")
    .notNull()
    .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
  systemId: text("system_id").notNull(),
  /**
   * Environment this run was executed for (per-environment fan-out).
   * null = ran with no environment (the opt-out / no-membership case,
   * which is exactly the pre-feature behavior). Nullable text, NOT a FK
   * to the catalog `environments` table (healthcheck and catalog are
   * separate plugins with separate Postgres schemas, mirroring how
   * `systemId` is a bare text with no FK to `systems`).
   */
  environmentId: text("environment_id"),
  status: healthCheckStatusEnum("status").notNull(),
  /** Execution duration in milliseconds */
  latencyMs: integer("latency_ms"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  /**
   * Source identifier for result attribution.
   * null = local core execution, UUID = satellite ID.
   */
  sourceId: text("source_id"),
  /**
   * Human-readable source label for UI display.
   * e.g. "Local" or "EU West (eu-west-1)".
   */
  sourceLabel: text("source_label"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

/**
 * Bucket size enum for aggregated data.
 */
export const bucketSizeEnum = pgEnum("bucket_size", ["hourly", "daily"]);

export type BucketSize = (typeof bucketSizeEnum.enumValues)[number];

/**
 * Aggregated health check data for long-term storage.
 * Core metrics (counts, latency) are auto-calculated by platform.
 * Strategy-specific result is aggregated via strategy.aggregateResult().
 */
export const healthCheckAggregates = pgTable(
  "health_check_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    /**
     * Environment this bucket aggregates. null = env-less runs. Part of the
     * unique key so per-environment buckets stay separate.
     */
    environmentId: text("environment_id"),
    bucketStart: timestamp("bucket_start").notNull(),
    bucketSize: bucketSizeEnum("bucket_size").notNull(),

    // Core metrics - auto-calculated by platform
    runCount: integer("run_count").notNull(),
    healthyCount: integer("healthy_count").notNull(),
    degradedCount: integer("degraded_count").notNull(),
    unhealthyCount: integer("unhealthy_count").notNull(),
    /** Sum of all latencies in this bucket (for accurate averaging when combining) */
    latencySumMs: integer("latency_sum_ms"),
    avgLatencyMs: integer("avg_latency_ms"),
    minLatencyMs: integer("min_latency_ms"),
    maxLatencyMs: integer("max_latency_ms"),
    p95LatencyMs: integer("p95_latency_ms"),

    // Strategy-specific aggregated result (versioned)
    aggregatedResult:
      jsonb("aggregated_result").$type<Record<string, unknown>>(),
    /** Serialized t-digest state for incremental p95 calculation */
    tdigestState: jsonb("tdigest_state").$type<number[]>(),
    /**
     * Source identifier for per-region aggregation.
     * null = local core execution, UUID = satellite ID.
     */
    sourceId: text("source_id"),
    /**
     * Human-readable source label for UI display.
     */
    sourceLabel: text("source_label"),
  },
  (t) => ({
    // Unique constraint includes environmentId (per-environment fan-out)
    // and sourceId (per-region aggregation). NULLS NOT DISTINCT ensures
    // env-less / local runs (environmentId / sourceId = NULL) correctly
    // conflict-match instead of creating duplicate rows per hour.
    bucketUnique: unique("health_check_aggregates_bucket_unique").on(
      t.configurationId,
      t.systemId,
      t.environmentId,
      t.bucketStart,
      t.bucketSize,
      t.sourceId,
    ).nullsNotDistinct(),
  }),
);
