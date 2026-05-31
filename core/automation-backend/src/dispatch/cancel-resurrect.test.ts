import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { createActionRegistry } from "../action-registry";
import { dispatchTrigger, resumeRun } from "./engine";
import { handleTriggerFiring } from "./trigger-subscriber";
import {
  makeDispatchDeps,
  makeRecordingAction,
  testPlugin,
} from "./test-fixtures";
import type { LoadedAutomation } from "./types";

const EVENT = "test.event";

function automation(actions: unknown[], mode = "single"): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Cancel test",
    triggers: [{ event: EVENT }],
    conditions: [],
    actions,
    mode,
    max_runs: 10,
  });
  return { id: "auto-1", name: "Cancel test", status: "enabled", definition };
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
    list: async () => ({ items: [], total: 0 }),
    listGroups: async () => [],
    findEnabledByTriggerEvent: async () => [auto],
    listEnabled: async () => [auto],
  };
}

describe("H1 — cancelled runs must not resurrect", () => {
  it("a cancelled (restart) run does not resume when its awaited trigger fires", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs, state } = makeDispatchDeps({ actions: actionsReg });

    // A run that opens, waits for a resolve event, then closes.
    const auto = automation([
      { action: "test.record", config: { value: "open" } },
      { wait_for_trigger: { event: "incident.resolved" } },
      { action: "test.record", config: { value: "close" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: EVENT,
      payload: {},
      contextKey: "incident-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["open"]);
    expect(runs.waitLocks.size).toBe(1);

    // Cancel it (restart mode / operator cancel both flip status to
    // "cancelled" and should tear down the wait lock + run-state).
    const cancelled = await deps.runStore.cancelActiveRuns(
      auto.id,
      "cancelled by test",
    );
    expect(cancelled).toContain(result.runId);
    // The cancel must have removed the wait lock + durable state.
    expect(runs.waitLocks.size).toBe(0);
    expect(state.states.has(result.runId)).toBe(false);

    // Now the awaited trigger fires. wakeWaitingRuns must NOT resume the
    // cancelled run, and the post-wait "close" action must NOT fire.
    await handleTriggerFiring({
      deps,
      automationStore: storeFor(auto),
      qualifiedEventId: "incident.resolved",
      triggerPayload: { resolved: true },
      actor: SYSTEM_ACTOR,
      contextKey: "incident-1",
    });

    expect(rec.calls.map((c) => c.value)).toEqual(["open"]);
    expect(runs.runs.get(result.runId)?.status).toBe("cancelled");
  });

  it("resumeRun directly refuses a cancelled run and drops any stale lock", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "open" } },
      { wait_for_trigger: { event: "go" } },
      { action: "test.record", config: { value: "close" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: EVENT,
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("waiting");

    // Cancel the run but leave a stale wait lock behind (simulating a path
    // that flipped status without cleanup) — resumeRun must refuse AND drop
    // the orphaned lock.
    runs.runs.get(result.runId)!.status = "cancelled";

    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: "actions[1]",
    });
    expect(resumed.status).toBe("cancelled");
    expect(rec.calls.map((c) => c.value)).toEqual(["open"]);
    expect(runs.waitLocks.size).toBe(0);
  });
});
