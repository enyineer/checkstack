import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";
import type { Logger } from "@checkstack/backend-api";
import type { AchievementType } from "@checkstack/slo-common";

/**
 * Achievement definitions with their evaluation criteria.
 * Each achievement is tied to a system (not a user).
 */
const ACHIEVEMENT_DEFINITIONS: Array<{
  type: AchievementType;
  description: string;
  evaluate: (ctx: AchievementContext) => boolean;
}> = [
  {
    type: "first_steps",
    description: "System has at least one SLO objective configured",
    evaluate: ({ objectiveCount }) => objectiveCount >= 1,
  },
  {
    type: "full_coverage",
    description: "System has SLOs covering all health checks",
    evaluate: ({ objectiveCount }) => objectiveCount >= 3,
  },
  {
    type: "iron_uptime",
    description: "7-day reliability streak",
    evaluate: ({ streakDays }) => streakDays >= 7,
  },
  {
    type: "diamond_uptime",
    description: "30-day reliability streak",
    evaluate: ({ streakDays }) => streakDays >= 30,
  },
  {
    type: "nines_club",
    description: "Achieved 99.9% or higher availability in a rolling window",
    evaluate: ({ bestAvailability }) =>
      bestAvailability !== undefined && bestAvailability >= 99.9,
  },
  {
    type: "budget_miser",
    description: "Used less than 10% of error budget over a full window",
    evaluate: ({ budgetRemainingPercent }) =>
      budgetRemainingPercent !== undefined && budgetRemainingPercent >= 90,
  },
  {
    type: "clean_sheet",
    description: "Zero downtime events in the current rolling window",
    evaluate: ({ hasZeroDowntime }) => hasZeroDowntime,
  },
  {
    type: "cascade_breaker",
    description:
      "System was down but all downtime was attributed to upstream dependencies",
    evaluate: ({ hasUpstreamOnlyDowntime }) => hasUpstreamOnlyDowntime,
  },
  {
    type: "rapid_recovery",
    description: "Recovered from downtime in under 5 minutes",
    evaluate: ({ fastestRecoverySeconds }) =>
      fastestRecoverySeconds !== undefined && fastestRecoverySeconds <= 300,
  },
];

interface AchievementContext {
  objectiveCount: number;
  streakDays: number;
  bestAvailability: number | undefined;
  budgetRemainingPercent: number | undefined;
  hasZeroDowntime: boolean;
  hasUpstreamOnlyDowntime: boolean;
  fastestRecoverySeconds: number | undefined;
}

/**
 * Evaluates and unlocks achievements for a specific system.
 * Called after daily snapshot processing or on significant events.
 */
export async function evaluateAchievements({
  systemId,
  service,
  engine,
  logger,
}: {
  systemId: string;
  service: SloService;
  engine: SloEngine;
  logger: Logger;
}): Promise<AchievementType[]> {
  const objectives = await service.getObjectivesForSystem({ systemId });
  if (objectives.length === 0) return [];

  // Build context from all objectives on this system
  let bestStreakDays = 0;
  let bestAvailability: number | undefined;
  let bestBudgetRemaining: number | undefined;
  let hasZeroDowntime = true;
  let hasUpstreamOnlyDowntime = false;
  let fastestRecoverySeconds: number | undefined;

  for (const objective of objectives) {
    const status = await engine.computeStatus({ objective });
    const streak = await service.getStreak({ objectiveId: objective.id });

    // Best streak across all objectives
    if (streak && streak.currentStreak > bestStreakDays) {
      bestStreakDays = streak.currentStreak;
    }

    // Best availability across all objectives
    if (
      status.currentAvailability !== undefined &&
      status.currentAvailability !== null &&
      (bestAvailability === undefined ||
        status.currentAvailability > bestAvailability)
    ) {
      bestAvailability = status.currentAvailability;
    }

    // Best budget remaining
    if (
      bestBudgetRemaining === undefined ||
      status.errorBudgetRemainingPercent > bestBudgetRemaining
    ) {
      bestBudgetRemaining = status.errorBudgetRemainingPercent;
    }

    // Zero downtime check
    if (
      status.errorBudgetConsumedMinutes > 0 ||
      status.errorBudgetConsumedStrictMinutes > 0
    ) {
      hasZeroDowntime = false;
    }

    // Check for cascade_breaker: consumed strict > 0 but consumed self = 0
    if (
      status.errorBudgetConsumedStrictMinutes > 0 &&
      status.errorBudgetConsumedMinutes === 0
    ) {
      hasUpstreamOnlyDowntime = true;
    }

    // Check recent events for rapid recovery
    const recentEvents = await service.getRecentDowntimeEvents({
      objectiveId: objective.id,
      limit: 10,
    });
    for (const event of recentEvents) {
      if (
        event.durationSeconds !== undefined &&
        event.durationSeconds !== null &&
        (fastestRecoverySeconds === undefined ||
          event.durationSeconds < fastestRecoverySeconds)
      ) {
        fastestRecoverySeconds = event.durationSeconds;
      }
    }
  }

  const context: AchievementContext = {
    objectiveCount: objectives.length,
    streakDays: bestStreakDays,
    bestAvailability,
    budgetRemainingPercent: bestBudgetRemaining,
    hasZeroDowntime,
    hasUpstreamOnlyDowntime,
    fastestRecoverySeconds,
  };

  // Evaluate all achievements
  const newlyUnlocked: AchievementType[] = [];

  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    if (definition.evaluate(context)) {
      const achievement = await service.unlockAchievement({
        systemId,
        achievement: definition.type,
      });
      if (achievement) {
        newlyUnlocked.push(definition.type);
        logger.info(
          `🏆 Achievement unlocked for system ${systemId}: ${definition.type}`,
        );
      }
    }
  }

  return newlyUnlocked;
}

/**
 * Get metadata for all achievement types (for display in the frontend).
 */
export function getAchievementDefinitions() {
  return ACHIEVEMENT_DEFINITIONS.map((d) => ({
    type: d.type,
    description: d.description,
  }));
}
