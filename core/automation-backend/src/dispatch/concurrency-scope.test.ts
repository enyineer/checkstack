import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  AutomationDefinitionSchema,
  type Automation,
  type ConcurrencyScope,
} from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { handleTriggerFiring } from "./trigger-subscriber";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import { createActionRegistry } from "../action-registry";
import type { LoadedAutomation } from "./types";

const EVENT = "test.event";

/**
 * An automation whose single action is a wait_for_trigger, so a started
 * run stays in `waiting` (active) - lets us observe concurrency dedup.
 */
function buildAutomation(
  scope: ConcurrencyScope,
  opts: { mode?: string; maxRuns?: number } = {},
): Automation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Concurrency test",
    triggers: [{ event: EVENT }],
    conditions: [],
    actions: [{ wait_for_trigger: { event: "never.fires" } }],
    mode: opts.mode ?? "single",
    concurrency_scope: scope,
    max_runs: opts.maxRuns ?? 10,
  });
  return {
    id: "auto-1",
    name: "Concurrency test",
    status: "enabled",
    definition,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStore(auto: Automation): AutomationStore {
  const loaded: LoadedAutomation = {
    id: auto.id,
    name: auto.name,
    status: auto.status,
    definition: auto.definition,
  };
  return {
    create: async () => {
      throw new Error("nope");
    },
    update: async () => {
      throw new Error("nope");
    },
    delete: async () => {},
    toggle: async () => {
      throw new Error("nope");
    },
    getById: async (id) =>
      id === auto.id
        ? {
            id: auto.id,
            name: auto.name,
            description: undefined,
            status: auto.status,
            definition: auto.definition,
            managedBy: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined,
    list: async () => ({ items: [auto], total: 1 }),
    listGroups: async () => [],
    findEnabledByTriggerEvent: async () => [loaded],
    listEnabled: async () => [loaded],
  };
}

function setup(
  scope: ConcurrencyScope,
  opts: { mode?: string; maxRuns?: number } = {},
) {
  const actionsReg = createActionRegistry();
  const rec = makeRecordingAction();
  actionsReg.register(rec.definition, testPlugin);
  const { deps, runs } = makeDispatchDeps({ actions: actionsReg });
  const auto = buildAutomation(scope, opts);
  const store = makeStore(auto);
  const fire = (systemId: string) =>
    handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: EVENT,
      triggerPayload: { id: systemId },
      actor: SYSTEM_ACTOR,
      contextKey: systemId,
    });
  return { deps, runs, fire };
}

/** Count runs that are currently active (a started run waits forever here). */
function activeCount(
  runs: ReturnType<typeof makeDispatchDeps>["runs"],
): number {
  return [...runs.runs.values()].filter((r) =>
    ["pending", "running", "waiting"].includes(r.status),
  ).length;
}

describe("concurrency_scope: automation (default)", () => {
  it("single mode dedups across ALL systems (one active run total)", async () => {
    const { runs, fire } = setup("automation");
    await fire("sys-a");
    await fire("sys-b"); // different system, but per-automation single -> skipped
    await fire("sys-a");
    expect(activeCount(runs)).toBe(1);
  });
});

describe("concurrency_scope: context_key", () => {
  it("single mode dedups per system but runs different systems concurrently", async () => {
    const { runs, fire } = setup("context_key");
    await fire("sys-a"); // starts run for A
    await fire("sys-b"); // starts run for B (different key)
    await fire("sys-a"); // A already active -> deduped
    await fire("sys-b"); // B already active -> deduped
    // One active run per distinct system, no duplicates.
    expect(activeCount(runs)).toBe(2);
    const byContext = new Map<string | null, number>();
    for (const r of runs.runs.values()) {
      if (!["pending", "running", "waiting"].includes(r.status)) continue;
      byContext.set(r.contextKey, (byContext.get(r.contextKey) ?? 0) + 1);
    }
    expect(byContext.get("sys-a")).toBe(1);
    expect(byContext.get("sys-b")).toBe(1);
  });
});

describe("concurrency modes (automation scope)", () => {
  it("parallel mode allows up to max_runs concurrent runs, then caps", async () => {
    const { runs, fire } = setup("automation", { mode: "parallel", maxRuns: 2 });
    await fire("a");
    await fire("b");
    await fire("c"); // over the cap → skipped
    expect(activeCount(runs)).toBe(2);
  });

  it("queued mode caps at max_runs (v1 behaves like parallel)", async () => {
    const { runs, fire } = setup("automation", { mode: "queued", maxRuns: 1 });
    await fire("a");
    await fire("b"); // over the cap → skipped
    expect(activeCount(runs)).toBe(1);
  });

  it("restart mode cancels the prior active run and starts fresh", async () => {
    const { runs, fire } = setup("automation", { mode: "restart" });
    await fire("a");
    const firstId = [...runs.runs.values()][0]!.id;
    await fire("b"); // cancels the first, starts a new run
    expect(runs.runs.get(firstId)?.status).toBe("cancelled");
    // Exactly one active run (the fresh one).
    expect(activeCount(runs)).toBe(1);
  });
});
