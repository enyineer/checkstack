import { describe, test, expect } from "bun:test";
import type { Logger, EmitHookFn, Hook } from "@checkstack/backend-api";
import type { SloObjective, SloStatus, SloStreak } from "@checkstack/slo-common";
import { runWeeklyDigest } from "./weekly-digest";
import { sloHooks } from "./hooks";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

/** The hook's payload shape, derived from the `Hook<T>` it carries. */
type DigestPayload =
  typeof sloHooks.sloWeeklyDigest extends Hook<infer T> ? T : never;

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function objective(
  over: Partial<SloObjective> & { id: string },
): SloObjective {
  return {
    id: over.id,
    systemId: over.systemId ?? `sys-${over.id}`,
    healthCheckConfigurationId: null,
    target: over.target ?? 99.9,
    windowDays: over.windowDays ?? 30,
    dependencyExclusion: over.dependencyExclusion ?? "self-only",
    excludedDependencyIds: over.excludedDependencyIds,
    excludeMaintenanceWindows: over.excludeMaintenanceWindows ?? false,
    burnRateThresholds: {
      warningPercent: 50,
      criticalPercent: 80,
      fastBurnMultiplier: 5,
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function status(over: Partial<SloStatus> & { systemId: string }): SloStatus {
  return {
    objectiveId: over.objectiveId ?? "obj",
    systemId: over.systemId,
    target: over.target ?? 99.9,
    windowDays: over.windowDays ?? 30,
    healthCheckConfigurationId: null,
    healthCheckConfigurationName: null,
    currentAvailability:
      "currentAvailability" in over ? over.currentAvailability! : 100,
    strictAvailability: 100,
    errorBudgetTotalMinutes: 43.2,
    errorBudgetConsumedMinutes: over.errorBudgetConsumedMinutes ?? 0,
    errorBudgetConsumedStrictMinutes: 0,
    errorBudgetRemainingMinutes: 43.2,
    errorBudgetRemainingPercent: over.errorBudgetRemainingPercent ?? 100,
    burnRate: 0,
    dependencyExclusion: "self-only",
    isBreaching: over.isBreaching ?? false,
    hasOpenDowntime: over.hasOpenDowntime ?? false,
    attribution: [],
  };
}

function streak(over: { objectiveId: string; currentStreak: number }): SloStreak {
  return {
    objectiveId: over.objectiveId,
    systemId: "sys",
    currentStreak: over.currentStreak,
    bestStreak: over.currentStreak,
    streakStart: null,
    bestStreakEnd: null,
  };
}

function makeDeps(args: {
  objectives: SloObjective[];
  statusFor: (objectiveId: string) => SloStatus;
  streaks?: SloStreak[];
}): {
  deps: {
    service: SloService;
    engine: SloEngine;
    logger: Logger;
    emitHook: EmitHookFn;
  };
  emitted: DigestPayload[];
} {
  const emitted: DigestPayload[] = [];
  const emitHook: EmitHookFn = async (hook, payload) => {
    if (hook === (sloHooks.sloWeeklyDigest as Hook<unknown>)) {
      emitted.push(payload as DigestPayload);
    }
  };

  const service = {
    listObjectives: async () => args.objectives,
    getAllStreaks: async () => args.streaks ?? [],
  } as unknown as SloService;

  const engine = {
    computeStatus: async ({ objective: o }: { objective: SloObjective }) =>
      args.statusFor(o.id),
  } as unknown as SloEngine;

  return { deps: { service, engine, logger: noopLogger, emitHook }, emitted };
}

describe("runWeeklyDigest", () => {
  test("skips entirely (no hook) when there are no objectives", async () => {
    const { deps, emitted } = makeDeps({
      objectives: [],
      statusFor: () => status({ systemId: "x" }),
    });
    await runWeeklyDigest(deps);
    expect(emitted).toEqual([]);
  });

  test("categorizes objectives into breaching / at-risk / healthy", async () => {
    const objectives = [
      objective({ id: "a" }),
      objective({ id: "b" }),
      objective({ id: "c" }),
      objective({ id: "d" }),
    ];
    const byId: Record<string, SloStatus> = {
      // breaching
      a: status({ systemId: "sys-a", isBreaching: true, errorBudgetRemainingPercent: 0 }),
      // at-risk: not breaching, budget <= 20
      b: status({ systemId: "sys-b", isBreaching: false, errorBudgetRemainingPercent: 20 }),
      // at-risk boundary just below
      c: status({ systemId: "sys-c", isBreaching: false, errorBudgetRemainingPercent: 5 }),
      // healthy: not breaching, budget > 20
      d: status({ systemId: "sys-d", isBreaching: false, errorBudgetRemainingPercent: 80 }),
    };
    const { deps, emitted } = makeDeps({
      objectives,
      statusFor: (id) => byId[id],
    });

    await runWeeklyDigest(deps);

    expect(emitted).toHaveLength(1);
    const p = emitted[0];
    expect(p.totalObjectives).toBe(4);
    expect(p.breachingCount).toBe(1);
    expect(p.atRiskCount).toBe(2);
    expect(p.healthyCount).toBe(1);
  });

  test("a breaching objective is never counted as at-risk even with low budget", async () => {
    const { deps, emitted } = makeDeps({
      objectives: [objective({ id: "a" })],
      statusFor: () =>
        status({ systemId: "sys-a", isBreaching: true, errorBudgetRemainingPercent: 10 }),
    });

    await runWeeklyDigest(deps);

    expect(emitted[0].breachingCount).toBe(1);
    expect(emitted[0].atRiskCount).toBe(0);
    expect(emitted[0].healthyCount).toBe(0);
  });

  test("top performers are the highest availability (desc), capped at 3, excluding null availability", async () => {
    const objectives = [
      objective({ id: "a" }),
      objective({ id: "b" }),
      objective({ id: "c" }),
      objective({ id: "d" }),
    ];
    const byId: Record<string, SloStatus> = {
      a: status({ systemId: "sys-a", currentAvailability: 90 }),
      b: status({ systemId: "sys-b", currentAvailability: 99.99 }),
      c: status({ systemId: "sys-c", currentAvailability: 95 }),
      // null availability is excluded from top performers entirely.
      d: status({ systemId: "sys-d", currentAvailability: null }),
    };
    const { deps, emitted } = makeDeps({
      objectives,
      statusFor: (id) => byId[id],
      streaks: [
        streak({ objectiveId: "b", currentStreak: 12 }),
        streak({ objectiveId: "c", currentStreak: 3 }),
      ],
    });

    await runWeeklyDigest(deps);

    const top = emitted[0].topPerformers;
    expect(top.map((t) => t.systemName)).toEqual(["sys-b", "sys-c", "sys-a"]);
    // streak days are joined in from getAllStreaks (0 when no streak row).
    expect(top[0]).toEqual({ systemName: "sys-b", availability: 99.99, streakDays: 12 });
    expect(top[2].streakDays).toBe(0);
  });

  test("worst performers are the lowest budget remaining (asc), capped at 3", async () => {
    const objectives = [
      objective({ id: "a" }),
      objective({ id: "b" }),
      objective({ id: "c" }),
      objective({ id: "d" }),
    ];
    const byId: Record<string, SloStatus> = {
      a: status({ systemId: "sys-a", errorBudgetRemainingPercent: 80, currentAvailability: 99 }),
      b: status({ systemId: "sys-b", errorBudgetRemainingPercent: 5, currentAvailability: 98 }),
      c: status({ systemId: "sys-c", errorBudgetRemainingPercent: 40, currentAvailability: 99.5 }),
      d: status({ systemId: "sys-d", errorBudgetRemainingPercent: 0, currentAvailability: 95 }),
    };
    const { deps, emitted } = makeDeps({
      objectives,
      statusFor: (id) => byId[id],
    });

    await runWeeklyDigest(deps);

    const worst = emitted[0].worstPerformers;
    expect(worst.map((w) => w.systemName)).toEqual(["sys-d", "sys-b", "sys-c"]);
    expect(worst[0]).toEqual({
      systemName: "sys-d",
      availability: 95,
      budgetRemainingPercent: 0,
    });
  });
});
