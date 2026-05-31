import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createActionRegistry } from "../action-registry";
import {
  checkWaitUntil,
  dispatchTrigger,
  WAIT_TIMEOUT_QUEUE_NAME,
} from "./engine";
import { startStalledSweeper } from "./stalled-sweeper";
import { createChangeDeriverRegistry } from "../entity/change-derivers";
import { routeEntityChange } from "./stage1-router";
import { handleDispatchJob, DISPATCH_QUEUE_NAME } from "./stage2-dispatch";
import type { EntityChanged } from "@checkstack/automation-common";
import { SYSTEM_ACTOR } from "@checkstack/common";
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

/**
 * A health client that flips to `flipped` on the Nth `getBulkHealthState`
 * call (1-based) — used to simulate a change landing in the wait_until ARM
 * WINDOW (between the lock being committed and the engine's re-evaluation).
 */
function flipOnNthBulkCall(args: {
  initial: string;
  flipped: string;
  nthCall: number;
}) {
  let calls = 0;
  const stateObj = (status: string) => ({
    status,
    inStatusSince: new Date(),
    inStatusForMs: 0,
    inMaintenance: false,
    evaluatedAt: new Date(),
  });
  return {
    callCount: () => calls,
    client: {
      getHealthState: async () => stateObj(args.initial),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        calls += 1;
        const status = calls >= args.nthCall ? args.flipped : args.initial;
        const states: Record<string, unknown> = {};
        for (const id of systemIds) states[id] = stateObj(status);
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
    listGroups: async () => [],
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
  const { deps, runs, queue, state } = makeDispatchDeps({
    actions: actionsReg,
    healthCheckClient: health.client,
  });
  return { deps, runs, queue, state, rec, health };
}

/** A `health:<id>` entity change, used to drive Stage-1 wake routing. */
function healthChange(id: string): EntityChanged {
  return {
    kind: "health",
    id,
    prev: { status: "unhealthy" },
    next: { status: "healthy" },
    delta: { status: "healthy" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
  };
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

describe("wait_until — reactive suspend + wake-index", () => {
  it("suspends with a wake-index ref and NO poll job, then a relevant change wakes + resumes", async () => {
    const { deps, runs, queue, rec, health } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION } },
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

    // Reactive: NO poll re-check job is enqueued (and no timeout was set).
    expect(queue.jobs).toHaveLength(0);

    // The wake-index recorded the health wildcard (health.system → kind:*).
    const lock = [...runs.waitLocks.values()][0]!;
    const refs = runs.wakeRefs.get(lock.id);
    expect(refs && [...refs]).toEqual(["health:*"]);

    // Stage-1 routing of a relevant ENTITY_CHANGED enqueues a Stage-2 wake.
    health.set("healthy");
    const changeDerivers = createChangeDeriverRegistry();
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers,
      changed: healthChange("sys-1"),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");
    // The Stage-2 wake job was enqueued onto the dispatch queue.
    expect(queue.jobs.some((j) => j.queue === DISPATCH_QUEUE_NAME)).toBe(true);

    // Run the Stage-2 wake job → re-eval (now true) → resume.
    await handleDispatchJob({
      deps,
      automationStore: storeFor(auto),
      changeDerivers,
      job: jobs[0]!,
    });
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["recovered"]);
    expect(runs.waitLocks.size).toBe(0);
  });

  it("a wake while the condition is still false does NOT resume (re-eval gate)", async () => {
    const { deps, runs, rec } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION } },
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

    const lock = [...runs.waitLocks.values()][0]!;
    // Still unhealthy → re-eval false → still-waiting.
    const outcome = await checkWaitUntil(deps, {
      runId: result.runId,
      waitLockId: lock.id,
      automation: auto,
    });
    expect(outcome).toBe("still-waiting");
    expect(rec.calls).toHaveLength(0);
    expect(runs.waitLocks.size).toBe(1);
  });
});

describe("wait_until — lost-wakeup arm-window guard (§17)", () => {
  it("resumes inline (no stall) when the condition becomes true between arming the lock and the re-eval", async () => {
    // The fast path sees `unhealthy` (call 1, at dispatch start), arms the
    // wait lock + wake-index, THEN the arm-window re-eval (call 2) sees the
    // system flip to `healthy` — modelling an ENTITY_CHANGED that landed
    // during the arm window and was NOT routed to a wake job. Without the
    // re-evaluate-on-registration guard this NO-TIMEOUT wait would stall
    // forever (the sweeper only re-checks locks with a timeout).
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const health = flipOnNthBulkCall({
      initial: "unhealthy",
      flipped: "healthy",
      nthCall: 2,
    });
    const { deps, runs, queue } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: health.client,
    });

    const auto = automation([
      { wait_until: { condition: CONDITION } },
      { action: "test.record", config: { value: "recovered" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });

    // Resumed inline: the run finished rather than stalling as `waiting`.
    expect(result.status).toBe("success");
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    // The post-wait action ran.
    expect(rec.calls.map((c) => c.value)).toEqual(["recovered"]);
    // The lock (and its wake-index rows) were cleaned up.
    expect(runs.waitLocks.size).toBe(0);
    // No timeout job was armed (no timeout was set), and crucially no poll
    // loop — the run completed purely via the inline re-eval.
    expect(queue.jobs).toHaveLength(0);
    // Sanity: the arm-window re-eval actually re-queried health.
    expect(health.callCount()).toBeGreaterThanOrEqual(2);
  });
});

describe("wait_until — timeout", () => {
  it("arms a single timeout timer job (not a poll loop)", async () => {
    const { deps, queue } = setup("unhealthy");
    const auto = automation([
      { wait_until: { condition: CONDITION, timeout_seconds: 60 } },
      { action: "test.record", config: { value: "escalate" } },
    ]);
    await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    const timeoutJobs = queue.jobs.filter(
      (j) => j.queue === WAIT_TIMEOUT_QUEUE_NAME,
    );
    expect(timeoutJobs).toHaveLength(1);
    expect(timeoutJobs[0]?.startDelay).toBeGreaterThan(0);
  });

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

describe("wait_until — timeout backstop via sweeper", () => {
  it("the sweeper applies the timeout policy for an expired until lock whose timer was lost", async () => {
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

    // The timeout timer job is "lost"; force the deadline into the past and
    // only the sweeper runs.
    const lock = [...runs.waitLocks.values()][0]!;
    lock.timeoutAt = new Date(Date.now() - 1000);
    const sweeper = startStalledSweeper({
      deps,
      automationStore: storeFor(auto),
      logger: deps.logger,
    });
    await sweeper.sweep();
    sweeper.stop();

    // continue_on_timeout defaults to true → run continues past the wait.
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["escalate"]);
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
              { wait_until: { condition: CONDITION } },
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
            { wait_until: { condition: CONDITION } },
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
              { wait_until: { condition: CONDITION } },
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
