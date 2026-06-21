import { describe, test, expect } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import type {
  SloObjective,
  SloStatus,
  SloStreak,
  SloDailySnapshot,
} from "@checkstack/slo-common";
import { runDailySnapshotJob } from "./streak-calculator";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

type SnapshotInput = Omit<SloDailySnapshot, "id">;

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
    systemId: over.systemId ?? "sys-1",
    healthCheckConfigurationId: over.healthCheckConfigurationId ?? null,
    target: over.target ?? 99.9,
    windowDays: over.windowDays ?? 30,
    dependencyExclusion: over.dependencyExclusion ?? "self-only",
    excludedDependencyIds: over.excludedDependencyIds,
    burnRateThresholds: over.burnRateThresholds ?? {
      warningPercent: 50,
      criticalPercent: 80,
      fastBurnMultiplier: 5,
    },
    createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: over.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

function status(over: Partial<SloStatus>): SloStatus {
  return {
    objectiveId: over.objectiveId ?? "obj-1",
    systemId: over.systemId ?? "sys-1",
    target: over.target ?? 99.9,
    windowDays: over.windowDays ?? 30,
    healthCheckConfigurationId: over.healthCheckConfigurationId ?? null,
    healthCheckConfigurationName: over.healthCheckConfigurationName ?? null,
    currentAvailability:
      "currentAvailability" in over ? over.currentAvailability! : 100,
    strictAvailability:
      "strictAvailability" in over ? over.strictAvailability! : 100,
    errorBudgetTotalMinutes: over.errorBudgetTotalMinutes ?? 43.2,
    errorBudgetConsumedMinutes: over.errorBudgetConsumedMinutes ?? 0,
    errorBudgetConsumedStrictMinutes:
      over.errorBudgetConsumedStrictMinutes ?? 0,
    errorBudgetRemainingMinutes: over.errorBudgetRemainingMinutes ?? 43.2,
    errorBudgetRemainingPercent: over.errorBudgetRemainingPercent ?? 100,
    burnRate: "burnRate" in over ? over.burnRate! : 0,
    dependencyExclusion: over.dependencyExclusion ?? "self-only",
    isBreaching: over.isBreaching ?? false,
    hasOpenDowntime: over.hasOpenDowntime ?? false,
    attribution: over.attribution ?? [],
  };
}

function streak(over: Partial<SloStreak> & { objectiveId: string }): SloStreak {
  return {
    objectiveId: over.objectiveId,
    systemId: over.systemId ?? "sys-1",
    currentStreak: over.currentStreak ?? 0,
    bestStreak: over.bestStreak ?? 0,
    streakStart: over.streakStart ?? null,
    bestStreakEnd: over.bestStreakEnd ?? null,
  };
}

interface Recorder {
  inserted: SnapshotInput[];
  incremented: string[];
  reset: string[];
  voided: string[];
}

/**
 * Build typed fakes for the daily-snapshot job's deps. The job is typed against
 * the concrete `SloService`/`SloEngine` classes, so the stubs are cast once (a
 * documented, unavoidable hand-rolled subset of the real surface the job
 * touches) — mirroring the existing `service.test.ts` stub style.
 */
function makeDeps(args: {
  objectives: SloObjective[];
  statusFor: (id: string) => SloStatus;
  streaks?: Record<string, SloStreak | undefined>;
  computeThrowsFor?: Set<string>;
}): {
  deps: {
    service: SloService;
    engine: SloEngine;
    logger: Logger;
    getSloEntity?: undefined;
  };
  rec: Recorder;
} {
  const rec: Recorder = {
    inserted: [],
    incremented: [],
    reset: [],
    voided: [],
  };
  const streaks: Record<string, SloStreak | undefined> = args.streaks ?? {};

  const service = {
    listObjectives: async () => args.objectives,
    getObjective: async ({ id }: { id: string }) =>
      args.objectives.find((o) => o.id === id) ?? null,
    getStreak: async ({ objectiveId }: { objectiveId: string }) =>
      streaks[objectiveId] ?? null,
    insertDailySnapshot: async ({
      snapshot,
    }: {
      snapshot: SnapshotInput;
    }) => {
      rec.inserted.push(snapshot);
    },
    incrementStreak: async ({ objectiveId }: { objectiveId: string }) => {
      rec.incremented.push(objectiveId);
      const prev = streaks[objectiveId];
      const nextStreak = (prev?.currentStreak ?? 0) + 1;
      streaks[objectiveId] = streak({
        objectiveId,
        currentStreak: nextStreak,
        bestStreak: Math.max(prev?.bestStreak ?? 0, nextStreak),
      });
    },
    resetStreak: async ({ objectiveId }: { objectiveId: string }) => {
      rec.reset.push(objectiveId);
      const prev = streaks[objectiveId];
      streaks[objectiveId] = streak({
        objectiveId,
        currentStreak: 0,
        bestStreak: prev?.bestStreak ?? 0,
      });
    },
  } as unknown as SloService;

  const engine = {
    reconcileOrphanedDowntime: async ({
      objective: o,
    }: {
      objective: SloObjective;
    }) => {
      rec.voided.push(o.id);
    },
    computeStatus: async ({ objective: o }: { objective: SloObjective }) => {
      if (args.computeThrowsFor?.has(o.id)) {
        throw new Error(`compute failed for ${o.id}`);
      }
      return args.statusFor(o.id);
    },
  } as unknown as SloEngine;

  return {
    deps: { service, engine, logger: noopLogger, getSloEntity: undefined },
    rec,
  };
}

describe("runDailySnapshotJob — streak transitions", () => {
  test("increments the streak when healthy (not breaching, no open downtime)", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ isBreaching: false, hasOpenDowntime: false }),
      streaks: { "obj-1": streak({ objectiveId: "obj-1", currentStreak: 3, bestStreak: 5 }) },
    });

    await runDailySnapshotJob(deps);

    expect(rec.incremented).toEqual(["obj-1"]);
    expect(rec.reset).toEqual([]);
  });

  test("does NOT increment when there is open downtime even if not breaching", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ isBreaching: false, hasOpenDowntime: true }),
      streaks: { "obj-1": streak({ objectiveId: "obj-1", currentStreak: 2, bestStreak: 2 }) },
    });

    await runDailySnapshotJob(deps);

    expect(rec.incremented).toEqual([]);
    expect(rec.reset).toEqual([]);
  });

  test("resets the streak when breaching and the current streak is > 0", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ isBreaching: true }),
      streaks: { "obj-1": streak({ objectiveId: "obj-1", currentStreak: 7, bestStreak: 7 }) },
    });

    await runDailySnapshotJob(deps);

    expect(rec.reset).toEqual(["obj-1"]);
    expect(rec.incremented).toEqual([]);
  });

  test("does NOT reset when breaching but the current streak is already 0", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ isBreaching: true }),
      streaks: { "obj-1": streak({ objectiveId: "obj-1", currentStreak: 0, bestStreak: 4 }) },
    });

    await runDailySnapshotJob(deps);

    expect(rec.reset).toEqual([]);
    expect(rec.incremented).toEqual([]);
  });

  test("treats a missing streak row as streak 0 (no reset on breach)", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ isBreaching: true }),
      streaks: {},
    });

    await runDailySnapshotJob(deps);

    expect(rec.reset).toEqual([]);
  });
});

describe("runDailySnapshotJob — snapshot persistence", () => {
  test("persists a daily snapshot per objective with status-derived fields at UTC midnight", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () =>
        status({
          currentAvailability: 98.5,
          errorBudgetConsumedMinutes: 42,
          errorBudgetRemainingPercent: 73.1,
          burnRate: 1.25,
        }),
      streaks: { "obj-1": streak({ objectiveId: "obj-1", currentStreak: 9, bestStreak: 9 }) },
    });

    await runDailySnapshotJob(deps);

    expect(rec.inserted).toHaveLength(1);
    const snap = rec.inserted[0];
    expect(snap.objectiveId).toBe("obj-1");
    expect(snap.availabilityPercent).toBe(98.5);
    expect(snap.budgetConsumedMinutes).toBe(42);
    expect(snap.budgetRemainingPercent).toBe(73.1);
    expect(snap.burnRate).toBe(1.25);
    // streak captured is the value BEFORE the increment runs this cycle.
    expect(snap.streakDays).toBe(9);
    // date is normalized to UTC midnight.
    expect(snap.date.getUTCHours()).toBe(0);
    expect(snap.date.getUTCMinutes()).toBe(0);
    expect(snap.date.getUTCSeconds()).toBe(0);
    expect(snap.date.getUTCMilliseconds()).toBe(0);
  });

  test("defaults availability to 100 and burnRate to null when the status omits them", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({ currentAvailability: null, burnRate: null }),
    });

    await runDailySnapshotJob(deps);

    expect(rec.inserted[0].availabilityPercent).toBe(100);
    expect(rec.inserted[0].burnRate).toBeNull();
    // missing streak row -> 0
    expect(rec.inserted[0].streakDays).toBe(0);
  });

  test("voids orphaned downtime before snapshotting each objective", async () => {
    const { deps, rec } = makeDeps({
      objectives: [objective({ id: "obj-1" })],
      statusFor: () => status({}),
    });

    await runDailySnapshotJob(deps);

    expect(rec.voided).toEqual(["obj-1"]);
  });
});

describe("runDailySnapshotJob — resilience", () => {
  test("processes every objective even when one throws (per-objective try/catch)", async () => {
    const { deps, rec } = makeDeps({
      objectives: [
        objective({ id: "a" }),
        objective({ id: "b" }),
        objective({ id: "c" }),
      ],
      statusFor: (id) => status({ objectiveId: id, isBreaching: false }),
      computeThrowsFor: new Set(["b"]),
      streaks: {
        a: streak({ objectiveId: "a", currentStreak: 1, bestStreak: 1 }),
        c: streak({ objectiveId: "c", currentStreak: 1, bestStreak: 1 }),
      },
    });

    await runDailySnapshotJob(deps);

    // a and c still get processed; b's failure is isolated.
    expect(rec.incremented.toSorted()).toEqual(["a", "c"]);
    expect(rec.inserted.map((s) => s.objectiveId).toSorted()).toEqual([
      "a",
      "c",
    ]);
  });

  test("no objectives is a no-op", async () => {
    const { deps, rec } = makeDeps({
      objectives: [],
      statusFor: () => status({}),
    });

    await runDailySnapshotJob(deps);

    expect(rec.inserted).toEqual([]);
    expect(rec.incremented).toEqual([]);
    expect(rec.reset).toEqual([]);
  });
});
