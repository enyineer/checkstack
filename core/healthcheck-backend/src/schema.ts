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
 * Records each time a check's *evaluated* state transitions from
 * non-unhealthy to unhealthy. Used to decide whether the per-check
 * incident threshold (N transitions in M minutes) has been met.
 * Pruned by the retention job alongside raw runs.
 */
export const healthCheckUnhealthyTransitions = pgTable(
  "health_check_unhealthy_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    transitionedAt: timestamp("transitioned_at").defaultNow().notNull(),
  },
  (t) => ({
    // Powers the threshold count query
    // (WHERE config_id = ? AND system_id = ? AND transitioned_at > ?).
    lookupIdx: index(
      "health_check_unhealthy_transitions_lookup_idx",
    ).on(t.configurationId, t.systemId, t.transitionedAt),
  }),
);

/**
 * Mapping of auto-opened incidents back to the system + check that
 * triggered them. `closedAt` stays null while the incident is active;
 * the auto-close worker sets it once the linked system has been
 * steadily healthy for the cooldown.
 *
 * No FK to the incident table — that lives in another plugin's schema
 * and we treat it as a soft reference (incident deletes are handled
 * by the auto-close worker, which tolerates missing rows).
 */
export const healthCheckAutoIncidents = pgTable(
  "health_check_auto_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id").notNull(),
    systemId: text("system_id").notNull(),
    configurationId: uuid("configuration_id")
      .notNull()
      .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
    /**
     * Auto-close cooldown snapshot taken when the incident was opened.
     * `null` means "never auto-close" — the worker leaves this
     * incident alone and an operator must resolve it manually. Stored
     * per-row so a later policy change doesn't retroactively alter
     * the close behaviour of incidents already in flight.
     */
    cooldownMinutes: integer("cooldown_minutes"),
  },
  (t) => ({
    // Powers "is there an active auto-incident for this system?" check.
    activeBySystemIdx: index(
      "health_check_auto_incidents_active_by_system_idx",
    ).on(t.systemId, t.closedAt),
    // Powers "find the most recent close for this assignment" lookup
    // used by the require-recovery-before-reopen check.
    lastCloseByAssignmentIdx: index(
      "health_check_auto_incidents_last_close_idx",
    ).on(t.configurationId, t.systemId, t.closedAt),
  }),
);

export const healthCheckRuns = pgTable("health_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id")
    .notNull()
    .references(() => healthCheckConfigurations.id, { onDelete: "cascade" }),
  systemId: text("system_id").notNull(),
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
    // Unique constraint includes sourceId for per-region aggregation.
    // NULLS NOT DISTINCT ensures local runs (sourceId=NULL) correctly
    // conflict-match instead of creating duplicate rows per hour.
    bucketUnique: unique("health_check_aggregates_bucket_unique").on(
      t.configurationId,
      t.systemId,
      t.bucketStart,
      t.bucketSize,
      t.sourceId,
    ).nullsNotDistinct(),
  }),
);
