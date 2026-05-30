import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createActionRegistry } from "../action-registry";
import {
  checkWaitUntil,
  dispatchTrigger,
  WAIT_UNTIL_QUEUE_NAME,
} from "./engine";
import { startStalledSweeper } from "./stalled-sweeper";
import {
  makeDispatchDeps,
  makeRecordingAction,
  testPlugin,
} from "./test-fixtures";
import type { LoadedAutomation } from "./types";
import type { AutomationStore } from "../automation-store";

/** A health client whose `system` status is mutable between checks. */
function mutableHealthClient(initial: string) {
  const state = { status: initial };
  const stateObj = () => ({
    status: state.status,
    inStatusSince: new Date(),
    inStatusForMs: 0,
    inMaintenance: false,
    evaluatedAt: new Date(),
  });
  return {
    set: (s: string) => {
      state.status = s;
    },
    client: {
      getHealthState: async () => stateObj(),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) states[id] = stateObj();
        return { states };
      },
    } as never,
  };
}

function automation(actions: unknown[]): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "WU",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions,
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "WU", status: "enabled", definition };
}

/** Minimal automation store returning a single fixed automation. */
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

const CONDITION = "health.system.status == 'healthy'";

function setup(initialStatus: string) {
  const actionsReg = createActionRegistry();
  const rec = makeRecordingAction();
  actionsReg.register(rec.definition, testPlugin);
  const health = mutableHealthClient(initialStatus);
  const { deps, runs, queue } = makeDispatchDeps({
    actions: actionsReg,
    healthCheckClient: health.client,
  });
  return { deps, runs, queue, rec, health };
}

describe("wait_until — immediate satisfaction", () => {
  it("continues inline without suspending when already true", async () => {
    const { deps, runs, rec } = setup("healthy");
    const auto = automation([
      { wait_until: { condition: CONDITION } },
      { action: "test.record", config: { value: "after" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("success");
    expect(runs.waitLocks.size).toBe(0);
    expect(rec.calls.map((c) => c.value)).toEqual(["after"]);
  });
});

describe("wait_until — becomes true", () => {
  it("suspends, then resumes when the condition turns true", async () => {
    const { deps, runs, queue, rec, health } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION, poll_seconds: 10 } },
      { action: "test.record", config: { value: "recovered" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");
    expect(runs.waitLocks.size).toBe(1);
    expect(rec.calls).toHaveLength(0);
    // First re-check job enqueued.
    expect(queue.jobs.some((j) => j.queue === WAIT_UNTIL_QUEUE_NAME)).toBe(true);

    const lock = [...runs.waitLocks.values()][0]!;

    // Still false → still-waiting, no resume.
    const o1 = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(o1).toBe("still-waiting");
    expect(rec.calls).toHaveLength(0);

    // Recover → next check resumes.
    health.set("healthy");
    const o2 = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(o2).toBe("resumed");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["recovered"]);
    expect(runs.waitLocks.size).toBe(0);
  });
});

describe("wait_until — timeout", () => {
  it("continues past on timeout when continue_on_timeout is true (default)", async () => {
    const { deps, runs, rec } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION, timeout_seconds: 60 } },
      { action: "test.record", config: { value: "escalate" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");
    const lock = [...runs.waitLocks.values()][0]!;
    // Force the deadline into the past.
    lock.timeoutAt = new Date(Date.now() - 1000);

    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("resumed");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["escalate"]);
  });

  it("fails the run on timeout when continue_on_timeout is false", async () => {
    const { deps, runs, rec } = setup("unhealthy");
    const auto = automation([
      {
        wait_until: {
          condition: CONDITION,
          timeout_seconds: 60,
          continue_on_timeout: false,
        },
      },
      { action: "test.record", config: { value: "after" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    const lock = [...runs.waitLocks.values()][0]!;
    lock.timeoutAt = new Date(Date.now() - 1000);

    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("failed");
    expect(runs.runs.get(result.runId)?.status).toBe("failed");
    expect(rec.calls).toHaveLength(0);
  });
});

describe("wait_until — restart recovery via sweeper", () => {
  it("the sweeper re-ticks an until lock whose re-check job was lost", async () => {
    const { deps, runs, rec, health } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION, poll_seconds: 10 } },
      { action: "test.record", config: { value: "recovered" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");

    // Recover; the queue job is "lost" — only the sweeper runs.
    health.set("healthy");
    const sweeper = startStalledSweeper({
      deps,
      automationStore: storeFor(auto),
      logger: deps.logger,
    });
    await sweeper.sweep();
    sweeper.stop();

    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["recovered"]);
    expect(runs.waitLocks.size).toBe(0);
  });
});

describe("wait_until — nested inside containers", () => {
  it("resumes a wait_until nested inside a choose branch", async () => {
    const { deps, runs, rec, health } = setup("unhealthy");
    const auto = automation([
      {
        choose: [
          {
            when: "trigger.payload.sev == 'crit'",
            sequence: [
              { action: "test.record", config: { value: "opened" } },
              { wait_until: { condition: CONDITION, poll_seconds: 10 } },
              { action: "test.record", config: { value: "closed" } },
            ],
          },
        ],
      },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1", sev: "crit" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["opened"]);

    const lock = [...runs.waitLocks.values()][0]!;
    expect(lock.actionPath).toBe("actions[0].choose[0].sequence[1]");

    health.set("healthy");
    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("resumed");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["opened", "closed"]);
  });

  it("resumes a wait_until nested inside a repeat iteration", async () => {
    const { deps, runs, rec, health } = setup("unhealthy");
    const auto = automation([
      {
        repeat: {
          count: 1,
          sequence: [
            { action: "test.record", config: { value: "iter" } },
            { wait_until: { condition: CONDITION, poll_seconds: 10 } },
            { action: "test.record", config: { value: "done" } },
          ],
        },
      },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["iter"]);

    const lock = [...runs.waitLocks.values()][0]!;
    health.set("healthy");
    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("resumed");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["iter", "done"]);
  });

  it("resumes a wait_until nested inside a parallel branch (via sequence)", async () => {
    const { deps, runs, rec, health } = setup("unhealthy");
    const auto = automation([
      {
        parallel: [
          {
            sequence: [
              { action: "test.record", config: { value: "branch-a" } },
              { wait_until: { condition: CONDITION, poll_seconds: 10 } },
              { action: "test.record", config: { value: "a-done" } },
            ],
          },
          { action: "test.record", config: { value: "branch-b" } },
        ],
      },
      { action: "test.record", config: { value: "after-parallel" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");
    // branch-a's first action + branch-b ran; branch-a suspended at the wait.
    expect(rec.calls.map((c) => c.value).sort()).toEqual(
      ["branch-a", "branch-b"].sort(),
    );

    const lock = [...runs.waitLocks.values()][0]!;
    health.set("healthy");
    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("resumed");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toContain("a-done");
    expect(rec.calls.map((c) => c.value)).toContain("after-parallel");
  });
});
