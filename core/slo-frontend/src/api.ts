// Re-export types for convenience
export type {
  SloObjective,
  SloStatus,
  SloDowntimeEvent,
  SloStreak,
  SloAchievement,
  SloDailySnapshot,
  DependencyExclusionMode,
  AttributionType,
} from "@checkstack/slo-common";
// Client definition - use with usePluginClient
export { SloApi } from "@checkstack/slo-common";
