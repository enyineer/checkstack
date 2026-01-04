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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { StateThresholds } from "@checkmate/healthcheck-common";
import type { VersionedRecord } from "@checkmate/backend-api";

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
    intervalSeconds: integer("interval_seconds").notNull(),
    isTemplate: boolean("is_template").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.systemId, t.configurationId] }),
  })
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
    avgLatencyMs: integer("avg_latency_ms"),
    minLatencyMs: integer("min_latency_ms"),
    maxLatencyMs: integer("max_latency_ms"),
    p95LatencyMs: integer("p95_latency_ms"),

    // Strategy-specific aggregated result (versioned)
    aggregatedResult:
      jsonb("aggregated_result").$type<Record<string, unknown>>(),
  },
  (t) => ({
    // Unique constraint for upsert operations
    bucketUnique: uniqueIndex("health_check_aggregates_bucket_unique").on(
      t.configurationId,
      t.systemId,
      t.bucketStart,
      t.bucketSize
    ),
  })
);
