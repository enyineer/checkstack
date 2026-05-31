import { describe, it, expect } from "bun:test";
import type { EntityHandle } from "@checkstack/automation-backend";

import {
  SLO_ENTITY_KIND,
  SloEntityStateSchema,
  deriveSloTriggerEvents,
  mirrorSloEntity,
  type SloEntityState,
} from "./slo-entity";

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

describe("mirrorSloEntity", () => {
  it("mirrors the budget + streak keyed by objectiveId", async () => {
    const calls: Array<{ id: string; next: SloEntityState }> = [];
    const handle = {
      kind: SLO_ENTITY_KIND,
      async set(id: string, next: SloEntityState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<SloEntityState>;
    await mirrorSloEntity({
      handle,
      objectiveId: "obj-7",
      systemId: "sys-7",
      target: 99.9,
      budgetRemainingPercent: 20,
      currentStreak: 4,
      bestStreak: 12,
    });
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

  it("is a no-op without a handle and routes errors to onError", async () => {
    await mirrorSloEntity({
      handle: undefined,
      objectiveId: "x",
      systemId: "x",
      target: 1,
      budgetRemainingPercent: 1,
      currentStreak: 0,
      bestStreak: 0,
    });
    let captured: unknown;
    const handle = {
      kind: SLO_ENTITY_KIND,
      async set() {
        throw new Error("nope");
      },
    } as unknown as EntityHandle<SloEntityState>;
    await mirrorSloEntity({
      handle,
      objectiveId: "x",
      systemId: "x",
      target: 1,
      budgetRemainingPercent: 1,
      currentStreak: 0,
      bestStreak: 0,
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("nope");
  });
});
