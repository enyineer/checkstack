import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  json,
} from "drizzle-orm/pg-core";

// =============================================================================
// SLO OBJECTIVES
// =============================================================================

/**
 * SLO objective definitions.
 * Multiple SLOs can exist per system. When healthCheckConfigurationId is null,
 * the SLO covers the system's aggregate availability across all health checks.
 */
export const sloObjectives = pgTable("slo_objectives", {
  id: text("id").primaryKey(),
  systemId: text("system_id").notNull(),
  healthCheckConfigurationId: text("health_check_configuration_id"),
  target: doublePrecision("target").notNull(),
  windowDays: integer("window_days").notNull(),
  dependencyExclusion: text("dependency_exclusion").notNull().default("strict"),
  excludedDependencyIds: json("excluded_dependency_ids").$type<string[]>(),
  burnRateWarningPercent: doublePrecision("burn_rate_warning_percent")
    .notNull()
    .default(50),
  burnRateCriticalPercent: doublePrecision("burn_rate_critical_percent")
    .notNull()
    .default(80),
  burnRateFastBurnMultiplier: doublePrecision("burn_rate_fast_burn_multiplier")
    .notNull()
    .default(5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =============================================================================
// DOWNTIME EVENTS (event-sourced)
// =============================================================================

/**
 * Event-sourced downtime records, written in real-time on SYSTEM_STATUS_CHANGED.
 *
 * Events are IMMUTABLE after creation. When attribution changes mid-outage
 * (e.g., upstream goes down after downstream), the open event is closed and a
 * new one is created with the correct attribution (event splitting).
 *
 * endTime = null indicates an ongoing outage.
 */
export const sloDowntimeEvents = pgTable("slo_downtime_events", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id")
    .notNull()
    .references(() => sloObjectives.id, { onDelete: "cascade" }),
  systemId: text("system_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  durationSeconds: doublePrecision("duration_seconds"),
  attributionType: text("attribution_type").notNull(),
  upstreamSystemId: text("upstream_system_id"),
  upstreamSystemName: text("upstream_system_name"),
});

// =============================================================================
// DAILY SNAPSHOTS
// =============================================================================

/**
 * Daily SLO snapshots for trend charts.
 * Persisted by a daily cron job at UTC midnight.
 */
export const sloDailySnapshots = pgTable("slo_daily_snapshots", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id")
    .notNull()
    .references(() => sloObjectives.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  availabilityPercent: doublePrecision("availability_percent").notNull(),
  budgetConsumedMinutes: doublePrecision("budget_consumed_minutes").notNull(),
  budgetRemainingPercent: doublePrecision("budget_remaining_percent").notNull(),
  burnRate: doublePrecision("burn_rate"),
  streakDays: integer("streak_days").notNull().default(0),
});

// =============================================================================
// STREAKS
// =============================================================================

/**
 * Streak tracking per SLO objective (1:1 relationship).
 * Updated daily by the streak calculator cron job.
 */
export const sloStreaks = pgTable("slo_streaks", {
  objectiveId: text("objective_id")
    .primaryKey()
    .references(() => sloObjectives.id, { onDelete: "cascade" }),
  systemId: text("system_id").notNull(),
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  streakStart: timestamp("streak_start"),
  bestStreakEnd: timestamp("best_streak_end"),
});

// =============================================================================
// ACHIEVEMENTS
// =============================================================================

/**
 * Achievement log — system-level only, no user attribution.
 * Idempotent: the achievement evaluator checks for existing entries before inserting.
 */
export const sloAchievements = pgTable("slo_achievements", {
  id: text("id").primaryKey(),
  systemId: text("system_id").notNull(),
  achievement: text("achievement").notNull(),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
});
