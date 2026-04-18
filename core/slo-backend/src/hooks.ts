import { createHook } from "@checkstack/backend-api";

/**
 * SLO hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to SLO lifecycle events.
 * Registered as integration events so they flow through configured notification channels.
 */
export const sloHooks = {
  /**
   * Emitted when an SLO's error budget consumption exceeds the warning threshold.
   */
  sloBudgetWarning: createHook<{
    systemId: string;
    objectiveId: string;
    target: number;
    budgetRemainingPercent: number;
  }>("slo.budget.warning"),

  /**
   * Emitted when an SLO's error budget consumption exceeds the critical threshold.
   */
  sloBudgetCritical: createHook<{
    systemId: string;
    objectiveId: string;
    target: number;
    budgetRemainingPercent: number;
  }>("slo.budget.critical"),

  /**
   * Emitted when an SLO's error budget is fully exhausted.
   */
  sloBudgetExhausted: createHook<{
    systemId: string;
    objectiveId: string;
    target: number;
  }>("slo.budget.exhausted"),

  /**
   * Emitted when a reliability streak is broken.
   */
  sloStreakBroken: createHook<{
    systemId: string;
    objectiveId: string;
    streak: number;
    bestStreak: number;
  }>("slo.streak.broken"),

  /**
   * Emitted when a system unlocks a new reliability achievement.
   */
  sloAchievementUnlocked: createHook<{
    systemId: string;
    achievement: string;
  }>("slo.achievement.unlocked"),
} as const;
