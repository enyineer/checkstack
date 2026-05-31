import { describe, it, expect } from "bun:test";
import type { EntityHandle } from "@checkstack/automation-backend";

import {
  SLO_ENTITY_KIND,
  SloEntityStateSchema,
  computeSloEntityState,
  createSloEntityRead,
  deriveSloTriggerEvents,
  writeSloEntity,
  type SloEntityState,
} from "./slo-entity";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

describe("deriveSloTriggerEvents", () => {
  it("fires no legacy trigger events (thresholds are numeric_state conditions, §9.2)", () => {
    expect(
      deriveSloTriggerEvents({
        kind: SLO_ENTITY_KIND,
        id: "obj-1",
        prev: null,
        next: {
          objectiveId: "obj-1",
          systemId: "sys-1",
          target: 99.9,
          budgetRemainingPercent: 10,
          currentStreak: 0,
          bestStreak: 5,
        },
        delta: {},
        changedFields: [],
        actor: { type: "system", id: "system" },
        occurredAt: new Date().toISOString(),
      }),
    ).toEqual([]);
  });
});

describe("SloEntityStateSchema", () => {
  it("parses the reactive subset", () => {
    const parsed = SloEntityStateSchema.parse({
      objectiveId: "o",
      systemId: "s",
      target: 99.5,
      budgetRemainingPercent: 42,
      currentStreak: 3,
      bestStreak: 9,
    });
    expect(parsed.budgetRemainingPercent).toBe(42);
  });
});

// ─── Fakes ──────────────────────────────────────────────────────────────

function makeService(over: {
  objective?: { id: string; systemId: string; target: number } | undefined;
  streak?: { currentStreak: number; bestStreak: number } | undefined;
}): SloService {
  return {
    async getObjective() {
      return over.objective;
    },
    async getStreak() {
      return over.streak;
    },
  } as unknown as SloService;
}

function makeEngine(budgetRemainingPercent: number): SloEngine {
  return {
    async computeStatus() {
      return { errorBudgetRemainingPercent: budgetRemainingPercent };
    },
  } as unknown as SloEngine;
}

describe("computeSloEntityState", () => {
  it("assembles the view by reading streak/objective + COMPUTING budget", async () => {
    const service = makeService({
      objective: { id: "obj-1", systemId: "sys-1", target: 99.9 },
      streak: { currentStreak: 4, bestStreak: 12 },
    });
    const engine = makeEngine(20);
    const state = await computeSloEntityState({
      service,
      engine,
      objectiveId: "obj-1",
    });
    expect(state).toEqual({
      objectiveId: "obj-1",
      systemId: "sys-1",
      target: 99.9,
      budgetRemainingPercent: 20,
      currentStreak: 4,
      bestStreak: 12,
    });
  });

  it("defaults missing streak counters to 0", async () => {
    const service = makeService({
      objective: { id: "obj-2", systemId: "sys-2", target: 99 },
      streak: undefined,
    });
    const state = await computeSloEntityState({
      service,
      engine: makeEngine(100),
      objectiveId: "obj-2",
    });
    expect(state?.currentStreak).toBe(0);
    expect(state?.bestStreak).toBe(0);
  });

  it("returns undefined when the objective no longer exists", async () => {
    const service = makeService({ objective: undefined });
    const state = await computeSloEntityState({
      service,
      engine: makeEngine(50),
      objectiveId: "gone",
    });
    expect(state).toBeUndefined();
  });
});

describe("createSloEntityRead", () => {
  it("computes the view per id and omits missing objectives", async () => {
    const service = {
      async getObjective({ id }: { id: string }) {
        if (id === "obj-1") return { id, systemId: "sys-1", target: 99.9 };
        return undefined;
      },
      async getStreak() {
        return { currentStreak: 2, bestStreak: 7 };
      },
    } as unknown as SloService;
    const read = createSloEntityRead({ service, engine: makeEngine(33) });
    const out = await read(["obj-1", "missing"]);
    expect(Object.keys(out)).toEqual(["obj-1"]);
    expect(out["obj-1"]).toEqual({
      objectiveId: "obj-1",
      systemId: "sys-1",
      target: 99.9,
      budgetRemainingPercent: 33,
      currentStreak: 2,
      bestStreak: 7,
    });
  });

  it("returns {} for an empty id list without touching the service", async () => {
    let called = false;
    const service = {
      async getObjective() {
        called = true;
        return undefined;
      },
    } as unknown as SloService;
    const read = createSloEntityRead({ service, engine: makeEngine(0) });
    expect(await read([])).toEqual({});
    expect(called).toBe(false);
  });
});

describe("writeSloEntity", () => {
  it("drives the streak write through handle.mutate keyed by objectiveId", async () => {
    const calls: Array<{ id: string; next: SloEntityState }> = [];
    const handle = {
      kind: SLO_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<SloEntityState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<SloEntityState>;

    let applied = false;
    await writeSloEntity({
      handle,
      objectiveId: "obj-7",
      apply: async () => {
        applied = true;
        return {
          objectiveId: "obj-7",
          systemId: "sys-7",
          target: 99.9,
          budgetRemainingPercent: 20,
          currentStreak: 4,
          bestStreak: 12,
        };
      },
    });
    expect(applied).toBe(true);
    expect(calls).toEqual([
      {
        id: "obj-7",
        next: {
          objectiveId: "obj-7",
          systemId: "sys-7",
          target: 99.9,
          budgetRemainingPercent: 20,
          currentStreak: 4,
          bestStreak: 12,
        },
      },
    ]);
  });

  it("still runs the streak write when no handle is wired", async () => {
    let applied = false;
    await writeSloEntity({
      handle: undefined,
      objectiveId: "x",
      apply: async () => {
        applied = true;
        return {
          objectiveId: "x",
          systemId: "x",
          target: 1,
          budgetRemainingPercent: 1,
          currentStreak: 0,
          bestStreak: 0,
        };
      },
    });
    expect(applied).toBe(true);
  });

  it("routes entity-layer errors to onError (fail-soft) without rethrowing", async () => {
    let captured: unknown;
    const handle = {
      kind: SLO_ENTITY_KIND,
      async mutate() {
        throw new Error("nope");
      },
    } as unknown as EntityHandle<SloEntityState>;
    await writeSloEntity({
      handle,
      objectiveId: "x",
      apply: async () => ({
        objectiveId: "x",
        systemId: "x",
        target: 1,
        budgetRemainingPercent: 1,
        currentStreak: 0,
        bestStreak: 0,
      }),
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("nope");
  });
});
