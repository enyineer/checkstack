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
 * Cause of a downtime event (orthogonal to {@link AttributionTypeSchema}, which
 * is the dependency dimension). This records WHY the system was down:
 * - healthcheck: a failed health-check probe (the default/legacy cause).
 * - incident: an active incident forced the system unhealthy/degraded via its
 *   `healthOverride`.
 *
 * Persisted as a nullable column; a NULL row (written before this field existed)
 * is read as `"healthcheck"`.
 */
export const DowntimeSourceSchema = z.enum(["healthcheck", "incident"]);
export type DowntimeSource = z.infer<typeof DowntimeSourceSchema>;

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
  /**
   * When true, downtime that overlaps a planned maintenance window on the
   * system is subtracted from the error budget. Defaults to false so existing
   * SLO numbers are preserved until a user opts in.
   */
  excludeMaintenanceWindows: z.boolean(),
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
  /**
   * What caused this downtime (see {@link DowntimeSourceSchema}). Optional for
   * backward compatibility with events persisted before the column existed; the
   * service maps a NULL row to `"healthcheck"`.
   */
  source: DowntimeSourceSchema.optional(),
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
 * SLO rolling-window length in days. Bounded on BOTH ends: at least 1 day, and
 * at most 10 years. The upper bound is load-bearing - the engine derives window
 * boundaries with `Date(now - windowDays * 86_400_000)`, so an unbounded value
 * (the API previously accepted any positive int up to 2^53) overflows past the
 * max representable Date and produces `Invalid Date`. That row commits fine but
 * then poisons EVERY read of the system's objectives (the serializer throws
 * `RangeError: Invalid time value`), a stored cluster-wide DoS. 3650 days keeps
 * all arithmetic well inside Date and int32 range.
 */
export const SLO_MAX_WINDOW_DAYS = 3650;
export const SloWindowDaysSchema = z
  .number()
  .int()
  .positive("Window must be at least 1 day")
  .max(SLO_MAX_WINDOW_DAYS, `Window must be at most ${SLO_MAX_WINDOW_DAYS} days`);

/**
 * Input for creating a new SLO objective.
 *
 * `teamId` is an optional hint for the create-mode team-ownership middleware
 * (`instanceAccess.create.teamIdParam`). The backend handler and service layer
 * never read this field — the middleware consumes it before the handler runs
 * and writes the owning-team grant after the handler returns.
 */
export const CreateSloObjectiveInputSchema = z.object({
  systemId: z.string().min(1, "System is required"),
  healthCheckConfigurationId: z.string().optional(),
  target: z
    .number()
    .min(0, "Target must be >= 0")
    .max(100, "Target must be <= 100"),
  windowDays: SloWindowDaysSchema,
  dependencyExclusion: DependencyExclusionModeSchema.optional().default(
    "strict",
  ),
  excludedDependencyIds: z.array(z.string()).optional().default([]),
  /**
   * Exclude planned maintenance windows from the error budget. Defaults to
   * false to preserve existing SLO numbers for callers that omit it.
   */
  excludeMaintenanceWindows: z.boolean().optional().default(false),
  burnRateThresholds: BurnRateThresholdsSchema.optional().default({
    warningPercent: 50,
    criticalPercent: 80,
    fastBurnMultiplier: 5,
  }),
  /** Optional owning-team id; consumed by autoAuthMiddleware, ignored by the handler. */
  teamId: z.string().optional(),
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
  windowDays: SloWindowDaysSchema.optional(),
  dependencyExclusion: DependencyExclusionModeSchema.optional(),
  excludedDependencyIds: z.array(z.string()).optional(),
  excludeMaintenanceWindows: z.boolean().optional(),
  burnRateThresholds: BurnRateThresholdsSchema.optional(),
});
export type UpdateSloObjectiveInput = z.infer<
  typeof UpdateSloObjectiveInputSchema
>;
