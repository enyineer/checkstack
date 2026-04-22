import { describe, it, expect } from "bun:test";
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementContext,
} from "./achievement-evaluator";

/**
 * Creates a base context with sensible defaults for testing.
 * All achievements should be OFF with these defaults.
 */
function baseContext(
  overrides?: Partial<AchievementContext>,
): AchievementContext {
  return {
    objectiveCount: 0,
    streakDays: 0,
    bestAvailability: undefined,
    budgetRemainingPercent: undefined,
    hasZeroDowntime: false,
    hasUpstreamOnlyDowntime: false,
    fastestRecoverySeconds: undefined,
    ...overrides,
  };
}

function findDefinition(type: string) {
  const def = ACHIEVEMENT_DEFINITIONS.find((d) => d.type === type);
  if (!def) throw new Error(`Achievement definition not found: ${type}`);
  return def;
}

describe("achievement definitions", () => {
  describe("nines_club", () => {
    const ninesClub = findDefinition("nines_club");

    it("requires both 99.99% availability AND 365-day streak", () => {
      const ctx = baseContext({
        bestAvailability: 99.995,
        streakDays: 365,
      });
      expect(ninesClub.evaluate(ctx)).toBe(true);
    });

    it("does NOT unlock with high availability but insufficient streak", () => {
      const ctx = baseContext({
        bestAvailability: 99.999,
        streakDays: 30,
      });
      expect(ninesClub.evaluate(ctx)).toBe(false);
    });

    it("does NOT unlock with 365-day streak but low availability", () => {
      const ctx = baseContext({
        bestAvailability: 99.98,
        streakDays: 400,
      });
      expect(ninesClub.evaluate(ctx)).toBe(false);
    });

    it("does NOT unlock with undefined availability even with long streak", () => {
      const ctx = baseContext({
        bestAvailability: undefined,
        streakDays: 500,
      });
      expect(ninesClub.evaluate(ctx)).toBe(false);
    });

    it("does NOT unlock on a freshly created SLO (zero streak, 100% availability)", () => {
      const ctx = baseContext({
        bestAvailability: 100.0,
        streakDays: 0,
      });
      expect(ninesClub.evaluate(ctx)).toBe(false);
    });
  });

  describe("iron_uptime", () => {
    const ironUptime = findDefinition("iron_uptime");

    it("unlocks at 7-day streak", () => {
      expect(ironUptime.evaluate(baseContext({ streakDays: 7 }))).toBe(true);
    });

    it("does NOT unlock below 7 days", () => {
      expect(ironUptime.evaluate(baseContext({ streakDays: 6 }))).toBe(false);
    });
  });

  describe("diamond_uptime", () => {
    const diamondUptime = findDefinition("diamond_uptime");

    it("unlocks at 30-day streak", () => {
      expect(diamondUptime.evaluate(baseContext({ streakDays: 30 }))).toBe(
        true,
      );
    });

    it("does NOT unlock below 30 days", () => {
      expect(diamondUptime.evaluate(baseContext({ streakDays: 29 }))).toBe(
        false,
      );
    });
  });

  describe("first_steps", () => {
    const firstSteps = findDefinition("first_steps");

    it("unlocks with 1 objective", () => {
      expect(firstSteps.evaluate(baseContext({ objectiveCount: 1 }))).toBe(
        true,
      );
    });

    it("does NOT unlock with 0 objectives", () => {
      expect(firstSteps.evaluate(baseContext({ objectiveCount: 0 }))).toBe(
        false,
      );
    });
  });

  describe("full_coverage", () => {
    const fullCoverage = findDefinition("full_coverage");

    it("unlocks with 3 or more objectives", () => {
      expect(fullCoverage.evaluate(baseContext({ objectiveCount: 3 }))).toBe(
        true,
      );
      expect(fullCoverage.evaluate(baseContext({ objectiveCount: 5 }))).toBe(
        true,
      );
    });

    it("does NOT unlock with fewer than 3 objectives", () => {
      expect(fullCoverage.evaluate(baseContext({ objectiveCount: 2 }))).toBe(
        false,
      );
    });
  });

  describe("budget_miser", () => {
    const budgetMiser = findDefinition("budget_miser");

    it("unlocks when 90% or more budget remaining", () => {
      expect(
        budgetMiser.evaluate(baseContext({ budgetRemainingPercent: 90 })),
      ).toBe(true);
      expect(
        budgetMiser.evaluate(baseContext({ budgetRemainingPercent: 99 })),
      ).toBe(true);
    });

    it("does NOT unlock below 90% remaining", () => {
      expect(
        budgetMiser.evaluate(baseContext({ budgetRemainingPercent: 89.9 })),
      ).toBe(false);
    });

    it("does NOT unlock with undefined budget", () => {
      expect(
        budgetMiser.evaluate(baseContext({ budgetRemainingPercent: undefined })),
      ).toBe(false);
    });
  });

  describe("clean_sheet", () => {
    const cleanSheet = findDefinition("clean_sheet");

    it("unlocks with zero downtime", () => {
      expect(cleanSheet.evaluate(baseContext({ hasZeroDowntime: true }))).toBe(
        true,
      );
    });

    it("does NOT unlock when downtime has occurred", () => {
      expect(cleanSheet.evaluate(baseContext({ hasZeroDowntime: false }))).toBe(
        false,
      );
    });
  });

  describe("cascade_breaker", () => {
    const cascadeBreaker = findDefinition("cascade_breaker");

    it("unlocks when all downtime is upstream-attributed", () => {
      expect(
        cascadeBreaker.evaluate(
          baseContext({ hasUpstreamOnlyDowntime: true }),
        ),
      ).toBe(true);
    });

    it("does NOT unlock without upstream-only downtime", () => {
      expect(
        cascadeBreaker.evaluate(
          baseContext({ hasUpstreamOnlyDowntime: false }),
        ),
      ).toBe(false);
    });
  });

  describe("rapid_recovery", () => {
    const rapidRecovery = findDefinition("rapid_recovery");

    it("unlocks with 5-minute or under recovery", () => {
      expect(
        rapidRecovery.evaluate(baseContext({ fastestRecoverySeconds: 300 })),
      ).toBe(true);
      expect(
        rapidRecovery.evaluate(baseContext({ fastestRecoverySeconds: 60 })),
      ).toBe(true);
    });

    it("does NOT unlock over 5 minutes", () => {
      expect(
        rapidRecovery.evaluate(baseContext({ fastestRecoverySeconds: 301 })),
      ).toBe(false);
    });
  });
});
