import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  AutomationDefinitionSchema,
  type Automation,
  type Trigger,
} from "@checkstack/automation-common";

import type { AutomationStore } from "../automation-store";
import { handleTriggerFiring } from "./trigger-subscriber";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import { createActionRegistry } from "../action-registry";
import type { LoadedAutomation } from "./types";

const EVENT = "healthcheck.system_health_changed";

function buildAutomation(opts: {
  id?: string;
  trigger: Partial<Trigger> & { event: string };
}): Automation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Window test",
    triggers: [opts.trigger],
    conditions: [],
    actions: [{ action: "test.record", config: { value: "fired" } }],
    mode: "parallel",
    max_runs: 100,
  });
  return {
    id: opts.id ?? "auto-1",
    name: "Window test",
    status: "enabled",
    definition,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeAutomationStore(automations: Automation[]): AutomationStore {
  const byId = new Map(automations.map((a) => [a.id, a]));
  const loaded = (a: Automation): LoadedAutomation => ({
    id: a.id,
    name: a.name,
    status: a.status,
    definition: a.definition,
  });
  return {
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {},
    toggle: async () => {
      throw new Error("not used");
    },
    getById: async (id) => byId.get(id),
    list: async () => ({ items: [...byId.values()], total: byId.size }),
    listGroups: async () => [],
    findEnabledByTriggerEvent: async (eventId) =>
      [...byId.values()]
        .filter(
          (a) =>
            a.status === "enabled" &&
            a.definition.triggers.some((t) => t.event === eventId),
        )
        .map(loaded),
    listEnabled: async () =>
      [...byId.values()].filter((a) => a.status === "enabled").map(loaded),
  };
}

function setup() {
  const actionsReg = createActionRegistry();
  const rec = makeRecordingAction();
  actionsReg.register(rec.definition, testPlugin);
  const { deps, runs, windows } = makeDispatchDeps({ actions: actionsReg });
  return { deps, runs, windows, rec };
}

/** Fire the trigger N times for one system; return how many runs started. */
async function fireN(opts: {
  deps: ReturnType<typeof setup>["deps"];
  store: AutomationStore;
  runs: ReturnType<typeof setup>["runs"];
  systemId: string;
  newStatus: string;
  times: number;
}): Promise<number> {
  const before = opts.runs.runs.size;
  for (let i = 0; i < opts.times; i++) {
    await handleTriggerFiring({
      deps: opts.deps,
      automationStore: opts.store,
      qualifiedEventId: EVENT,
      triggerPayload: {
        systemId: opts.systemId,
        newStatus: opts.newStatus,
        previousStatus: "healthy",
      },
      actor: SYSTEM_ACTOR,
      contextKey: opts.systemId,
    });
  }
  return opts.runs.runs.size - before;
}

describe("windowed-count trigger gate", () => {
  it("does not fire below the threshold, then fires once it is reached", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "flapping",
          event: EVENT,
          window: { count: 3, minutes: 60, refire: "every" },
        },
      }),
    ]);

    // 2 occurrences ⇒ no run.
    let started = await fireN({
      deps,
      store,
      runs,
      systemId: "sys-1",
      newStatus: "unhealthy",
      times: 2,
    });
    expect(started).toBe(0);

    // 3rd occurrence crosses ⇒ run starts.
    started = await fireN({
      deps,
      store,
      runs,
      systemId: "sys-1",
      newStatus: "unhealthy",
      times: 1,
    });
    expect(started).toBe(1);
  });

  it("only counts POST-FILTER occurrences (filter gates before the window)", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "flapping",
          event: EVENT,
          filter: 'trigger.payload.newStatus != "healthy"',
          window: { count: 2, minutes: 60, refire: "once" },
        },
      }),
    ]);

    // Healthy transitions don't pass the filter ⇒ not counted.
    let started = await fireN({
      deps,
      store,
      runs,
      systemId: "sys-1",
      newStatus: "healthy",
      times: 5,
    });
    expect(started).toBe(0);

    // Two unhealthy transitions ⇒ edge fires once.
    started = await fireN({
      deps,
      store,
      runs,
      systemId: "sys-1",
      newStatus: "unhealthy",
      times: 2,
    });
    expect(started).toBe(1);
  });

  it("`every` re-fires on every occurrence past the threshold; `once` fires only on the edge", async () => {
    // every
    {
      const { deps, runs } = setup();
      const store = makeAutomationStore([
        buildAutomation({
          trigger: {
            id: "f",
            event: EVENT,
            window: { count: 2, minutes: 60, refire: "every" },
          },
        }),
      ]);
      const started = await fireN({
        deps,
        store,
        runs,
        systemId: "sys-1",
        newStatus: "unhealthy",
        times: 4,
      });
      // occurrences 2,3,4 all fire (>= 2) ⇒ 3 runs.
      expect(started).toBe(3);
    }
    // once
    {
      const { deps, runs } = setup();
      const store = makeAutomationStore([
        buildAutomation({
          trigger: {
            id: "f",
            event: EVENT,
            window: { count: 2, minutes: 60, refire: "once" },
          },
        }),
      ]);
      const started = await fireN({
        deps,
        store,
        runs,
        systemId: "sys-1",
        newStatus: "unhealthy",
        times: 4,
      });
      // only occurrence 2 (=== 2) fires ⇒ 1 run.
      expect(started).toBe(1);
    }
  });

  it("windows are isolated per context key (per system)", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          window: { count: 3, minutes: 60, refire: "once" },
        },
      }),
    ]);

    await fireN({ deps, store, runs, systemId: "sys-1", newStatus: "unhealthy", times: 2 });
    await fireN({ deps, store, runs, systemId: "sys-2", newStatus: "unhealthy", times: 2 });
    // Neither system has reached 3 yet.
    expect(runs.runs.size).toBe(0);

    // sys-1 reaches 3 ⇒ fires; sys-2 still at 2.
    const startedSys1 = await fireN({
      deps,
      store,
      runs,
      systemId: "sys-1",
      newStatus: "unhealthy",
      times: 1,
    });
    expect(startedSys1).toBe(1);
  });
});

/**
 * Fire the trigger `times` with an arbitrary payload + contextKey; returns how
 * many runs started. Lets partitionBy tests vary a payload field (e.g.
 * severity) independently of the built-in contextKey (systemId).
 */
async function firePayloads(opts: {
  deps: ReturnType<typeof setup>["deps"];
  store: AutomationStore;
  runs: ReturnType<typeof setup>["runs"];
  payload: Record<string, unknown>;
  contextKey: string | null;
  times: number;
}): Promise<number> {
  const before = opts.runs.runs.size;
  for (let i = 0; i < opts.times; i++) {
    await handleTriggerFiring({
      deps: opts.deps,
      automationStore: opts.store,
      qualifiedEventId: EVENT,
      triggerPayload: opts.payload,
      actor: SYSTEM_ACTOR,
      contextKey: opts.contextKey,
    });
  }
  return opts.runs.runs.size - before;
}

describe("windowed-count trigger gate — partitionBy", () => {
  it("partitions the count by the evaluated expression value", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          window: {
            count: 2,
            minutes: 60,
            refire: "once",
            partitionBy: "trigger.payload.severity",
          },
        },
      }),
    ]);

    // Same system (contextKey sys-1), different severities ⇒ independent windows.
    // Two `high` reach the threshold and fire; one `low` does not.
    let started = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "high" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(started).toBe(0); // high count 1

    started = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "low" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(started).toBe(0); // low count 1 (separate partition)

    started = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "high" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(started).toBe(1); // high count 2 ⇒ fires on its own partition
  });

  it("keeps two distinct evaluated values in independent windows", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          window: {
            count: 3,
            minutes: 60,
            refire: "once",
            partitionBy: "trigger.payload.severity",
          },
        },
      }),
    ]);

    await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "high" },
      contextKey: "sys-1",
      times: 2,
    });
    await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "low" },
      contextKey: "sys-1",
      times: 2,
    });
    // Neither partition has reached 3 yet (2 each).
    expect(runs.runs.size).toBe(0);

    const started = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1", severity: "high" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(started).toBe(1); // `high` reaches 3
  });

  it("omitted partitionBy ⇒ built-in contextKey (unchanged) — composite split by system", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          window: { count: 2, minutes: 60, refire: "once" },
        },
      }),
    ]);

    // Two systems, two events each: each is its own partition (the contextKey),
    // so each fires once on its 2nd event.
    await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    const startedSys2First = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-2" },
      contextKey: "sys-2",
      times: 1,
    });
    expect(startedSys2First).toBe(0); // each system at count 1

    const startedSys1Second = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(startedSys1Second).toBe(1); // sys-1 reaches 2
  });

  it("partitionBy evaluating to empty/undefined falls back to the built-in contextKey", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          // `missing` is not in the payload ⇒ evaluates to undefined ⇒ fall
          // back to contextKey (systemId). So per-system counting applies.
          window: {
            count: 2,
            minutes: 60,
            refire: "once",
            partitionBy: "trigger.payload.missing",
          },
        },
      }),
    ]);

    await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    // A different system must NOT share the bucket (fallback is per-context, not global).
    const startedSys2 = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-2" },
      contextKey: "sys-2",
      times: 1,
    });
    expect(startedSys2).toBe(0); // sys-2 at count 1 (own bucket)

    const startedSys1 = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(startedSys1).toBe(1); // sys-1 reaches 2 in its own (fallback) bucket
  });

  it("partitionBy that throws on eval falls back to the built-in contextKey (fail-open)", async () => {
    const { deps, runs } = setup();
    const store = makeAutomationStore([
      buildAutomation({
        trigger: {
          id: "f",
          event: EVENT,
          // Unparseable expression ⇒ eval throws ⇒ fall back to contextKey.
          window: {
            count: 2,
            minutes: 60,
            refire: "once",
            partitionBy: "trigger.payload.(((",
          },
        },
      }),
    ]);

    await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    const startedSys1 = await firePayloads({
      deps,
      store,
      runs,
      payload: { systemId: "sys-1" },
      contextKey: "sys-1",
      times: 1,
    });
    expect(startedSys1).toBe(1); // counted per system via fallback
  });
});
