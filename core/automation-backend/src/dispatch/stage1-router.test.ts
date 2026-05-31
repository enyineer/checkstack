import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { EntityChanged, DispatchJob } from "@checkstack/automation-common";
import { SYSTEM_ACTOR } from "@checkstack/common";

import { createActionRegistry } from "../action-registry";
import { createChangeDeriverRegistry } from "../entity/change-derivers";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import { routeEntityChange, ENTITY_ROUTE_WORKER_GROUP } from "./stage1-router";
import { DISPATCH_QUEUE_NAME } from "./stage2-dispatch";
import type { AutomationStore } from "../automation-store";
import type { LoadedAutomation } from "./types";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: "fake",
    id: "ent-1",
    prev: null,
    next: { status: "open" },
    delta: { status: "open" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeAutomation(): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "A",
    triggers: [{ event: "fake.opened" }],
    conditions: [],
    actions: [{ action: "test.record", config: { value: "ran" } }],
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "A", status: "enabled", definition };
}

function storeWith(autos: LoadedAutomation[]): AutomationStore {
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
    getById: async (id) => {
      const a = autos.find((x) => x.id === id);
      return a
        ? {
            id: a.id,
            name: a.name,
            description: undefined,
            status: a.status,
            definition: a.definition,
            managedBy: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined;
    },
    list: async () => ({ items: [], total: 0 }),
    findEnabledByTriggerEvent: async (eventId) =>
      autos.filter((a) => a.definition.triggers.some((t) => t.event === eventId)),
    listEnabled: async () => autos,
  };
}

describe("ENTITY_ROUTE_WORKER_GROUP", () => {
  it("is the documented Stage-1 worker group", () => {
    expect(ENTITY_ROUTE_WORKER_GROUP).toBe("automation-entity-route");
  });
});

describe("Stage-1 routeEntityChange — fresh triggers via deriver", () => {
  it("routes a change to a Stage-2 trigger job via a registered fake deriver", async () => {
    const actions = createActionRegistry();
    actions.register(makeRecordingAction().definition, testPlugin);
    const { deps, queue } = makeDispatchDeps({ actions });

    const changeDerivers = createChangeDeriverRegistry();
    changeDerivers.register({
      kind: "fake",
      derive: (c) => (c.next?.status === "open" ? ["fake.opened"] : []),
    });

    const auto = fakeAutomation();
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([auto]),
      changeDerivers,
      changed: change(),
    });

    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.reason).toBe("trigger");
    if (job.reason === "trigger") {
      expect(job.automationId).toBe("auto-1");
      expect(job.triggerId).toBe("fake.opened");
      expect(job.ref).toBe("fake:ent-1");
    }
    // The job was enqueued onto the dispatch queue.
    expect(queue.jobs.some((j) => j.queue === DISPATCH_QUEUE_NAME)).toBe(true);
  });

  it("routes nothing when no deriver is registered (Phase-5 production default)", async () => {
    const { deps } = makeDispatchDeps();
    const changeDerivers = createChangeDeriverRegistry();
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([fakeAutomation()]),
      changeDerivers,
      changed: change(),
    });
    expect(jobs).toHaveLength(0);
  });

  it("derives multiple event ids and fans out to each referencing automation", async () => {
    const { deps } = makeDispatchDeps();
    const changeDerivers = createChangeDeriverRegistry();
    changeDerivers.register({
      kind: "fake",
      derive: () => ["fake.opened", "fake.touched"],
    });

    const a1 = fakeAutomation();
    const a2def = AutomationDefinitionSchema.parse({
      name: "B",
      triggers: [{ event: "fake.touched" }],
      conditions: [],
      actions: [{ action: "test.record", config: { value: "ran" } }],
      mode: "single",
      max_runs: 10,
    });
    const a2: LoadedAutomation = {
      id: "auto-2",
      name: "B",
      status: "enabled",
      definition: a2def,
    };

    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([a1, a2]),
      changeDerivers,
      changed: change(),
    });
    const triggerJobs = jobs.filter((j): j is Extract<DispatchJob, { reason: "trigger" }> => j.reason === "trigger");
    expect(triggerJobs.map((j) => j.automationId).toSorted()).toEqual([
      "auto-1",
      "auto-2",
    ]);
  });
});

describe("Stage-1 trigger jobId — dedup by changeId, not occurredAt", () => {
  /** Re-route the same logical change and collect the trigger job ids. */
  async function triggerJobIdsFor(changed: EntityChanged): Promise<string[]> {
    const actions = createActionRegistry();
    actions.register(makeRecordingAction().definition, testPlugin);
    const { deps, queue } = makeDispatchDeps({ actions });
    const changeDerivers = createChangeDeriverRegistry();
    changeDerivers.register({
      kind: "fake",
      derive: (c) => (c.next?.status === "open" ? ["fake.opened"] : []),
    });
    await routeEntityChange({
      deps,
      automationStore: storeWith([fakeAutomation()]),
      changeDerivers,
      changed,
    });
    return queue.jobs
      .filter((j) => j.queue === DISPATCH_QUEUE_NAME && j.jobId?.startsWith("trigger:"))
      .map((j) => j.jobId!)
      .filter((id): id is string => id !== undefined);
  }

  it("two DISTINCT changes within one ms (distinct changeId) get distinct jobIds", async () => {
    // Same entity, same occurredAt (ms granularity collides), distinct change.
    const at = new Date().toISOString();
    const idsA = await triggerJobIdsFor(
      change({ occurredAt: at, changeId: "chg-A" }),
    );
    const idsB = await triggerJobIdsFor(
      change({ occurredAt: at, changeId: "chg-B" }),
    );
    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);
    // The wall-clock occurredAt is identical, but the changeId distinguishes
    // them → distinct jobIds → BullMQ keeps both runs.
    expect(idsA[0]).not.toBe(idsB[0]);
    expect(idsA[0]).toContain("chg-A");
    expect(idsB[0]).toContain("chg-B");
  });

  it("a REDELIVERY of one change (same changeId) derives the SAME jobId (deduped)", async () => {
    const changed = change({ changeId: "chg-redelivered" });
    const first = await triggerJobIdsFor(changed);
    // A redelivery carries the same payload (changeId travels with it).
    const second = await triggerJobIdsFor(changed);
    expect(first[0]).toBe(second[0]);
  });

  it("falls back to occurredAt for legacy payloads without a changeId", async () => {
    const at = new Date().toISOString();
    const ids = await triggerJobIdsFor(change({ occurredAt: at }));
    expect(ids[0]).toContain(at);
  });
});

describe("Stage-1 routeEntityChange — waiting runs via wake-index", () => {
  it("routes a Stage-2 wake job for a wait whose ref matches", async () => {
    const { deps, runs } = makeDispatchDeps();

    // Seed a reactive until-lock depending on `fake:ent-1`.
    await deps.runStore.createRun({
      automationId: "auto-1",
      triggerId: "t",
      triggerEventId: "test.event",
      triggerPayload: {},
      contextKey: "ent-1",
    });
    const lockId = await deps.runStore.createWaitLockWithWakeRefs({
      runId: "run-1",
      actionPath: "actions[0]",
      eventId: "@@until",
      contextKey: "ent-1",
      timeoutAt: null,
      waitConfig: {
        condition: "state.fake['ent-1'].status == 'open'",
        continueOnTimeout: true,
      },
      wakeRefs: ["fake:ent-1"],
    });
    void lockId;

    const changeDerivers = createChangeDeriverRegistry();
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([]),
      changeDerivers,
      changed: change(),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");
    if (jobs[0]?.reason === "wake") {
      expect(jobs[0].runId).toBe("run-1");
      expect(jobs[0].ref).toBe("fake:ent-1");
    }
    expect(runs.waitLocks.size).toBe(1);
  });

  it("matches a kind-level wildcard wait", async () => {
    const { deps } = makeDispatchDeps();
    await deps.runStore.createRun({
      automationId: "auto-1",
      triggerId: "t",
      triggerEventId: "test.event",
      triggerPayload: {},
      contextKey: null,
    });
    await deps.runStore.createWaitLockWithWakeRefs({
      runId: "run-1",
      actionPath: "actions[0]",
      eventId: "@@until",
      contextKey: null,
      timeoutAt: null,
      waitConfig: {
        condition: "state.fake[trigger.id].status == 'open'",
        continueOnTimeout: true,
      },
      wakeRefs: ["fake:*"],
    });

    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([]),
      changeDerivers: createChangeDeriverRegistry(),
      changed: change({ id: "ent-99" }),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");
  });

  it("does not match a wait depending on a different ref", async () => {
    const { deps } = makeDispatchDeps();
    await deps.runStore.createRun({
      automationId: "auto-1",
      triggerId: "t",
      triggerEventId: "test.event",
      triggerPayload: {},
      contextKey: null,
    });
    await deps.runStore.createWaitLockWithWakeRefs({
      runId: "run-1",
      actionPath: "actions[0]",
      eventId: "@@until",
      contextKey: null,
      timeoutAt: null,
      waitConfig: {
        condition: "state.fake['other'].status == 'open'",
        continueOnTimeout: true,
      },
      wakeRefs: ["fake:other"],
    });

    const jobs = await routeEntityChange({
      deps,
      automationStore: storeWith([]),
      changeDerivers: createChangeDeriverRegistry(),
      changed: change({ id: "ent-1" }),
    });
    expect(jobs).toHaveLength(0);
  });
});
