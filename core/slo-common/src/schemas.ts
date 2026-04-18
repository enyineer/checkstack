import { z } from "zod";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Dependency exclusion mode for SLO error budget calculation.
 * - strict: Count ALL downtime regardless of cause
 * - self-only: Only count self-caused downtime (upstream-attributed downtime is excluded)
 */
export const DependencyExclusionModeSchema = z.enum([
  "strict",
  "self-only",
]);
export type DependencyExclusionMode = z.infer<
  typeof DependencyExclusionModeSchema
>;

/**
 * Attribution type for a downtime event.
 * - self: Downtime is caused by the system itself
 * - upstream: Downtime is attributed to an upstream dependency failure
 */
export const AttributionTypeSchema = z.enum(["self", "upstream"]);
export type AttributionType = z.infer<typeof AttributionTypeSchema>;

/**
 * Achievement types that can be unlocked by systems.
 */
export const AchievementTypeSchema = z.enum([
  "first_steps",
  "iron_uptime",
  "diamond_uptime",
  "budget_miser",
  "clean_sheet",
  "nines_club",
  "cascade_breaker",
  "full_coverage",
  "rapid_recovery",
]);
export type AchievementType = z.infer<typeof AchievementTypeSchema>;

// =============================================================================
// CONFIGURABLE THRESHOLDS
// =============================================================================

/**
 * Burn rate alert thresholds, configurable per SLO objective.
 */
export const BurnRateThresholdsSchema = z.object({
  warningPercent: z.number().min(0).max(100).default(50),
  criticalPercent: z.number().min(0).max(100).default(80),
  fastBurnMultiplier: z.number().min(1).default(5),
});
export type BurnRateThresholds = z.infer<typeof BurnRateThresholdsSchema>;

// =============================================================================
// CORE ENTITIES
// =============================================================================

/**
 * SLO objective definition.
 * Represents a reliability target for a system (or a specific health check on a system).
 * Multiple SLOs can be defined per system. When healthCheckConfigurationId is null,
 * the SLO applies to the system's aggregate availability across all health checks.
 */
export const SloObjectiveSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  healthCheckConfigurationId: z.string().nullable(),
  target: z.number().min(0).max(100),
  windowDays: z.number().int().positive(),
  dependencyExclusion: DependencyExclusionModeSchema,
  excludedDependencyIds: z.array(z.string()).optional(),
  burnRateThresholds: BurnRateThresholdsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SloObjective = z.infer<typeof SloObjectiveSchema>;

/**
 * Event-sourced downtime record, written in real-time on SYSTEM_STATUS_CHANGED.
 * Events are immutable after creation — when attribution changes mid-outage,
 * the open event is closed and a new one starts (event splitting).
 */
export const SloDowntimeEventSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  systemId: z.string(),
  startTime: z.date(),
  endTime: z.date().nullable(),
  durationSeconds: z.number().nullable(),
  attributionType: AttributionTypeSchema,
  upstreamSystemId: z.string().nullable(),
  upstreamSystemName: z.string().nullable(),
});
export type SloDowntimeEvent = z.infer<typeof SloDowntimeEventSchema>;

/**
 * Daily SLO snapshot for trend charts.
 * Persisted by a daily cron job at UTC midnight.
 */
export const SloDailySnapshotSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  date: z.date(),
  availabilityPercent: z.number(),
  budgetConsumedMinutes: z.number(),
  budgetRemainingPercent: z.number(),
  burnRate: z.number().nullable(),
  streakDays: z.number(),
});
export type SloDailySnapshot = z.infer<typeof SloDailySnapshotSchema>;

/**
 * Streak tracking for an SLO objective.
 * One streak record per objective (1:1).
 */
export const SloStreakSchema = z.object({
  objectiveId: z.string(),
  systemId: z.string(),
  currentStreak: z.number(),
  bestStreak: z.number(),
  streakStart: z.date().nullable(),
  bestStreakEnd: z.date().nullable(),
});
export type SloStreak = z.infer<typeof SloStreakSchema>;

/**
 * Achievement unlocked by a system.
 * System-centric only — no user attribution.
 */
export const SloAchievementSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  achievement: AchievementTypeSchema,
  unlockedAt: z.date(),
});
export type SloAchievement = z.infer<typeof SloAchievementSchema>;

// =============================================================================
// COMPUTED STATUS (returned by API, not persisted)
// =============================================================================

/**
 * Attribution breakdown entry for a single source (self or an upstream dependency).
 */
export const SloAttributionEntrySchema = z.object({
  sourceType: AttributionTypeSchema,
  systemId: z.string().optional(),
  systemName: z.string().optional(),
  minutes: z.number(),
});
export type SloAttributionEntry = z.infer<typeof SloAttributionEntrySchema>;

/**
 * Computed SLO status for display, aggregated from downtime events.
 * Returned by the API, not persisted directly.
 */
export const SloStatusSchema = z.object({
  objectiveId: z.string(),
  systemId: z.string(),
  target: z.number(),
  windowDays: z.number(),
  healthCheckConfigurationId: z.string().nullable(),
  healthCheckConfigurationName: z.string().nullable(),
  currentAvailability: z.number().nullable(),
  strictAvailability: z.number().nullable(),
  errorBudgetTotalMinutes: z.number(),
  errorBudgetConsumedMinutes: z.number(),
  errorBudgetConsumedStrictMinutes: z.number(),
  errorBudgetRemainingMinutes: z.number(),
  errorBudgetRemainingPercent: z.number(),
  burnRate: z.number().nullable(),
  dependencyExclusion: DependencyExclusionModeSchema,
  isBreaching: z.boolean(),
  hasOpenDowntime: z.boolean(),
  attribution: z.array(SloAttributionEntrySchema),
});
export type SloStatus = z.infer<typeof SloStatusSchema>;

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

/**
 * Input for creating a new SLO objective.
 */
export const CreateSloObjectiveInputSchema = z.object({
  systemId: z.string().min(1, "System is required"),
  healthCheckConfigurationId: z.string().optional(),
  target: z
    .number()
    .min(0, "Target must be >= 0")
    .max(100, "Target must be <= 100"),
  windowDays: z.number().int().positive("Window must be at least 1 day"),
  dependencyExclusion: DependencyExclusionModeSchema.optional().default(
    "strict",
  ),
  excludedDependencyIds: z.array(z.string()).optional().default([]),
  burnRateThresholds: BurnRateThresholdsSchema.optional().default({
    warningPercent: 50,
    criticalPercent: 80,
    fastBurnMultiplier: 5,
  }),
});
export type CreateSloObjectiveInput = z.infer<
  typeof CreateSloObjectiveInputSchema
>;

/**
 * Input for updating an existing SLO objective.
 */
export const UpdateSloObjectiveInputSchema = z.object({
  id: z.string(),
  target: z.number().min(0).max(100).optional(),
  windowDays: z.number().int().positive().optional(),
  dependencyExclusion: DependencyExclusionModeSchema.optional(),
  excludedDependencyIds: z.array(z.string()).optional(),
  burnRateThresholds: BurnRateThresholdsSchema.optional(),
});
export type UpdateSloObjectiveInput = z.infer<
  typeof UpdateSloObjectiveInputSchema
>;
