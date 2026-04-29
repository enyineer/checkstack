export { sloAccess, sloAccessRules } from "./access";
export { sloContract, SloApi, type SloContract } from "./rpc-contract";
export {
  DependencyExclusionModeSchema,
  AttributionTypeSchema,
  AchievementTypeSchema,
  BurnRateThresholdsSchema,
  SloObjectiveSchema,
  SloDowntimeEventSchema,
  SloDailySnapshotSchema,
  SloStreakSchema,
  SloAchievementSchema,
  SloAttributionEntrySchema,
  SloStatusSchema,
  CreateSloObjectiveInputSchema,
  UpdateSloObjectiveInputSchema,
  type DependencyExclusionMode,
  type AttributionType,
  type AchievementType,
  type BurnRateThresholds,
  type SloObjective,
  type SloDowntimeEvent,
  type SloDailySnapshot,
  type SloStreak,
  type SloAchievement,
  type SloAttributionEntry,
  type SloStatus,
  type CreateSloObjectiveInput,
  type UpdateSloObjectiveInput,
} from "./schemas";
export * from "./plugin-metadata";
export { sloRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when an SLO's status changes (budget consumed, breach started/ended).
 * Frontend components can refetch SLO data for the affected system.
 */
export const SLO_STATUS_CHANGED = createSignal({
  pluginMetadata,
  event: "status.changed",
  payloadSchema: z.object({
    systemId: z.string(),
    objectiveId: z.string(),
    budgetRemainingPercent: z.number(),
    isBreaching: z.boolean(),
  }),
});

/**
 * Broadcast when a streak is updated (incremented or broken).
 * Used to update streak counter UI in real-time.
 */
export const SLO_STREAK_UPDATED = createSignal({
  pluginMetadata,
  event: "streak.updated",
  payloadSchema: z.object({
    systemId: z.string(),
    objectiveId: z.string(),
    currentStreak: z.number(),
    broken: z.boolean(),
  }),
});

/**
 * Broadcast when a system unlocks a new achievement.
 * Used to trigger celebration UI and milestone feed updates.
 */
export const SLO_ACHIEVEMENT_UNLOCKED = createSignal({
  pluginMetadata,
  event: "achievement.unlocked",
  payloadSchema: z.object({
    systemId: z.string(),
    achievement: z.string(),
  }),
});
