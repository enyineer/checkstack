import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { EntityChanged, DispatchJob } from "@checkstack/automation-common";
import { SYSTEM_ACTOR } from "@checkstack/common";

import { createActionRegistry } from "../action-registry";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import { handleDispatchJob } from "./stage2-dispatch";
import { createChangeDeriverRegistry } from "../entity/change-derivers";
import type { AutomationStore } from "../automation-store";
import type { LoadedAutomation } from "./types";

/** An empty registry: every change falls back to the generic payload shape. */
function emptyDerivers() {
  return createChangeDeriverRegistry();
}

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: "fake",
    id: "ent-1",
    prev: null,
    next: { status: "open", severity: "high" },
    delta: { status: "open" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function automationFor(event: string): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "A",
    triggers: [{ event }],
    conditions: [],
    actions: [{ action: "test.record", config: { value: "{{ trigger.payload.status }}" } }],
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "A", status: "enabled", definition };
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
    findEnabledByTriggerEvent: async () => [auto],
    listEnabled: async () => [auto],
  };
}

describe("Stage-2 handleDispatchJob — reason: trigger", () => {
  it("starts a fresh run for the matched automation, with the change as payload", async () => {
    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions });

    const auto = automationFor("fake.opened");
    const job: DispatchJob = {
      reason: "trigger",
      automationId: "auto-1",
      triggerId: "fake.opened",
      ref: "fake:ent-1",
      changed: change(),
    };

    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: emptyDerivers(), job });

    // The action ran with the entity-change's `next.status` in payload.
    expect(rec.calls.map((c) => c.value)).toEqual(["open"]);
    // A run row exists and reached a terminal status.
    expect([...runs.runs.values()].map((r) => r.status)).toEqual(["success"]);
  });

  it("drops the job when the automation is gone", async () => {
    const { deps, runs } = makeDispatchDeps();
    const job: DispatchJob = {
      reason: "trigger",
      automationId: "missing",
      triggerId: "fake.opened",
      ref: "fake:ent-1",
      changed: change(),
    };
    await handleDispatchJob({
      deps,
      automationStore: storeFor(automationFor("fake.opened")),
      changeDerivers: emptyDerivers(),
      job,
    });
    expect(runs.runs.size).toBe(0);
  });

  it("does not run a disabled automation", async () => {
    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions });
    const auto = automationFor("fake.opened");
    auto.status = "disabled";
    const job: DispatchJob = {
      reason: "trigger",
      automationId: "auto-1",
      triggerId: "fake.opened",
      ref: "fake:ent-1",
      changed: change(),
    };
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: emptyDerivers(), job });
    expect(rec.calls).toHaveLength(0);
    expect(runs.runs.size).toBe(0);
  });
});

describe("Stage-2 handleDispatchJob — reason: wake", () => {
  it("resumes a suspended wait_until whose condition now holds", async () => {
    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);

    // Health client that reports healthy, so the wait re-eval passes.
    const healthClient = {
      getHealthState: async () => ({
        status: "healthy",
        inStatusSince: new Date(),
        inStatusForMs: 0,
        inMaintenance: false,
        evaluatedAt: new Date(),
      }),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) {
          states[id] = {
            status: "healthy",
            inStatusSince: new Date(),
            inStatusForMs: 0,
            inMaintenance: false,
            evaluatedAt: new Date(),
          };
        }
        return { states };
      },
    } as never;

    const { deps, runs } = makeDispatchDeps({ actions, healthCheckClient: healthClient });

    // Build an automation with a wait_until then a recording action, suspend
    // it by dispatching while unhealthy is irrelevant — we seed the lock
    // directly and drive the wake.
    const definition = AutomationDefinitionSchema.parse({
      name: "WU",
      triggers: [{ event: "test.event" }],
      conditions: [],
      actions: [
        { wait_until: { condition: "health.system.status == 'healthy'" } },
        { action: "test.record", config: { value: "woke" } },
      ],
      mode: "single",
      max_runs: 10,
    });
    const auto: LoadedAutomation = {
      id: "auto-1",
      name: "WU",
      status: "enabled",
      definition,
    };

    // Suspend the run via the engine so the lock + scope snapshot exist.
    const unhealthyDeps = makeDispatchDeps({
      actions,
      healthCheckClient: {
        getHealthState: async () => ({
          status: "unhealthy",
          inStatusSince: new Date(),
          inStatusForMs: 0,
          inMaintenance: false,
          evaluatedAt: new Date(),
        }),
        getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
          const states: Record<string, unknown> = {};
          for (const id of systemIds) {
            states[id] = {
              status: "unhealthy",
              inStatusSince: new Date(),
              inStatusForMs: 0,
              inMaintenance: false,
              evaluatedAt: new Date(),
            };
          }
          return { states };
        },
      } as never,
    });
    // Use one shared deps so the run/lock seeded by the engine is the one the
    // wake reads. Re-dispatch on `deps` (healthy) would immediately satisfy,
    // so instead seed with unhealthy deps and then wake with healthy deps
    // pointing at the SAME stores.
    void unhealthyDeps;

    // Simplest faithful path: dispatch on `deps` but with health unhealthy
    // first is not possible (deps is healthy). Instead seed the lock + run
    // manually and drive the wake re-eval (healthy → resume).
    await deps.runStore.createRun({
      automationId: "auto-1",
      triggerId: "t",
      triggerEventId: "test.event",
      triggerPayload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    await deps.runStore.updateRunStatus("run-1", "waiting");
    await deps.runStateStore.upsert({
      runId: "run-1",
      scopeSnapshot: { trigger: { payload: { id: "sys-1" } } },
      lastActionPath: null,
    });
    const lockId = await deps.runStore.createWaitLockWithWakeRefs({
      runId: "run-1",
      actionPath: "actions[0]",
      eventId: "@@until",
      contextKey: "sys-1",
      timeoutAt: null,
      waitConfig: {
        condition: "health.system.status == 'healthy'",
        continueOnTimeout: true,
      },
      wakeRefs: ["health:*"],
    });

    const job: DispatchJob = {
      reason: "wake",
      runId: "run-1",
      waitLockId: lockId,
      ref: "health:sys-1",
      changed: change({ kind: "health", id: "sys-1" }),
    };
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: emptyDerivers(), job });

    // Re-eval passed (healthy) → resumed → recording action ran.
    expect(rec.calls.map((c) => c.value)).toEqual(["woke"]);
    expect(runs.runs.get("run-1")?.status).toBe("success");
    expect(runs.waitLocks.size).toBe(0);
  });

  it("drops a wake job whose lock is gone", async () => {
    const { deps } = makeDispatchDeps();
    const job: DispatchJob = {
      reason: "wake",
      runId: "run-x",
      waitLockId: "missing",
      ref: "fake:ent-1",
      changed: change(),
    };
    // No throw, no-op.
    await handleDispatchJob({
      deps,
      automationStore: storeFor(automationFor("x")),
      changeDerivers: emptyDerivers(),
      job,
    });
    expect(true).toBe(true);
  });
});
