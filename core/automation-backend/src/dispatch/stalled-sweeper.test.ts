import { describe, expect, it } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { createActionRegistry } from "../action-registry";
import { dispatchTrigger, recoverStalledRun } from "./engine";
import { startStalledSweeper } from "./stalled-sweeper";
import {
  makeDispatchDeps,
  makeRecordingAction,
  testPlugin,
} from "./test-fixtures";
import type { LoadedAutomation } from "./types";

function automation(actions: unknown[]): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Sweeper test",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions,
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "Sweeper test", status: "enabled", definition, runAs: "app-test" };
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
            runAs: auto.runAs,
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

describe("stalled sweeper — C1: must not re-walk an intentional wait", () => {
  it("does not re-run pre-wait actions or leak wait locks when sweeping a mid-wait run", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs, state } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "before-delay" } },
      { delay: { seconds: 3600 } },
      { action: "test.record", config: { value: "after-delay" } },
    ]);

    // Genuinely dispatch — the run suspends on the delay (one wait lock, a
    // checkpoint at the delay's path).
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["before-delay"]);
    expect(runs.waitLocks.size).toBe(1);

    // Simulate the crash window: the heartbeat went cold and the run row
    // still reads "running" (the engine flips to running before each step;
    // a mid-wait crash can leave it that way while the wait lock lives on).
    // This is exactly the state that made the OLD sweeper re-walk from the
    // top — `findStalledRunIds` returned it AND recoverStalledRun accepted
    // it despite the live wait lock.
    runs.runs.get(result.runId)!.status = "running";
    state.states.get(result.runId)!.lastHeartbeatAt = new Date(
      Date.now() - 10 * 60_000,
    );

    // Run the REAL sweeper. The delay-expiry sweep won't fire (timeoutAt is
    // an hour out), so only the stalled-run sweep can touch this run.
    const sweeper = startStalledSweeper({
      deps,
      automationStore: storeFor(auto),
      logger: deps.logger,
      staleAfterMs: 1,
      intervalMs: 1_000_000,
    });
    await sweeper.sweep();
    sweeper.stop();

    // The pre-wait action must NOT have re-executed, and no extra wait lock
    // may have accumulated (no duplicate delay job either).
    expect(rec.calls.map((c) => c.value)).toEqual(["before-delay"]);
    expect(runs.waitLocks.size).toBe(1);
  });
});

describe("stalled sweeper — H4 + C1c: recoverStalledRun refuses a run holding a live wait lock", () => {
  it("does not re-walk or create a duplicate lock for a crash-mid-wait run", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "before-delay" } },
      { delay: { seconds: 3600 } },
      { action: "test.record", config: { value: "after-delay" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(result.status).toBe("waiting");
    expect(runs.waitLocks.size).toBe(1);

    // Simulate a crash that left the run marked `running` while still
    // holding its wait lock (a status the wait paths hadn't yet cleared).
    runs.runs.get(result.runId)!.status = "running";

    const recovered = await recoverStalledRun(deps, {
      runId: result.runId,
      automation: auto,
    });

    // Recovery must refuse: no re-walk, no second wait lock, no duplicate
    // delay job.
    expect(recovered.status).toBe("running");
    expect(rec.calls.map((c) => c.value)).toEqual(["before-delay"]);
    expect(runs.waitLocks.size).toBe(1);
  });
});

describe("stalled sweeper — windowed-count occurrence prune", () => {
  it("deletes occurrence rows older than the 24h cap, keeping fresh ones", async () => {
    const { deps, windows } = makeDispatchDeps({});

    // One stale row (25h ago) + one fresh row (now).
    await windows.store.recordAndCount({
      automationId: "auto-1",
      triggerId: "f",
      eventId: "e",
      contextKey: "sys-1",
      occurredAt: new Date(Date.now() - 25 * 60 * 60_000),
      windowMinutes: 60,
      threshold: 1,
      refire: "every",
    });
    await windows.store.recordAndCount({
      automationId: "auto-1",
      triggerId: "f",
      eventId: "e",
      contextKey: "sys-1",
      occurredAt: new Date(),
      windowMinutes: 60,
      threshold: 1,
      refire: "every",
    });
    expect(windows.events).toHaveLength(2);

    const sweeper = startStalledSweeper({
      deps,
      automationStore: storeFor(automation([])),
      logger: deps.logger,
      staleAfterMs: 1,
      intervalMs: 1_000_000,
    });
    await sweeper.sweep();
    sweeper.stop();

    // The stale row is pruned; the fresh one survives.
    expect(windows.events).toHaveLength(1);
    expect(windows.events[0]!.occurredAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });
});
