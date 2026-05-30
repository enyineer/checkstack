import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { createActionRegistry } from "../action-registry";
import { handleTriggerFiring } from "./trigger-subscriber";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import type { LoadedAutomation } from "./types";

const EVENT = "test.event";

/** Single-mode automation whose run stays active (waits forever). */
function buildAutomation(): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Race test",
    triggers: [{ event: EVENT }],
    conditions: [],
    actions: [{ wait_for_trigger: { event: "never.fires" } }],
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "Race test", status: "enabled", definition };
}

function storeFor(auto: LoadedAutomation): AutomationStore {
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
    getById: async () => undefined,
    list: async () => ({ items: [], total: 0 }),
    findEnabledByTriggerEvent: async () => [auto],
    listEnabled: async () => [auto],
  };
}

function activeCount(runs: ReturnType<typeof makeDispatchDeps>["runs"]): number {
  return [...runs.runs.values()].filter((r) =>
    ["pending", "running", "waiting"].includes(r.status),
  ).length;
}

describe("M1 — concurrency check-then-create race (single mode)", () => {
  it("two concurrent fires create exactly one run", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeRecordingAction().definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions: actionsReg,
      withConcurrencyLock: true,
    });
    const auto = buildAutomation();

    // Widen the check-then-create window with a real async gap, so that
    // WITHOUT serialization both fires can complete their "is a run active?"
    // check before either has created its run — the exact interleaving that
    // double-runs a single-mode automation. WITH the lock, the second fire
    // blocks at lock-acquire and only checks after the first committed, so
    // the gap is harmless. (Macrotask yield, not a 2-party barrier, so it
    // works in both the locked and unlocked variants without deadlock.)
    const realHasActiveRun = deps.runStore.hasActiveRun.bind(deps.runStore);
    deps.runStore.hasActiveRun = async (automationId, contextKey) => {
      const result = await realHasActiveRun(automationId, contextKey);
      await new Promise((r) => setTimeout(r, 5));
      return result;
    };

    const fire = () =>
      handleTriggerFiring({
        deps,
        automationStore: storeFor(auto),
        qualifiedEventId: EVENT,
        triggerPayload: { id: "sys-1" },
        actor: SYSTEM_ACTOR,
        contextKey: "sys-1",
      });

    await Promise.all([fire(), fire()]);

    expect(activeCount(runs)).toBe(1);
  });
});
