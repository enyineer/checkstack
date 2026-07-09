import { describe, it, expect, setSystemTime } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  AutomationDefinitionSchema,
  type Automation,
  type Trigger,
} from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { armDwell, fireDwell } from "./dwell";
import { handleTriggerFiring, startRunRespectingMode } from "./trigger-subscriber";
import { startStalledSweeper } from "./stalled-sweeper";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import { createActionRegistry } from "../action-registry";
import { createTriggerRegistry } from "../trigger-registry";
import { createNumericStateTrigger } from "../builtin-triggers";
import type { TriggerDefinition } from "../action-types";
import type { LoadedAutomation } from "./types";

const EVENT = "test.event";

/** Build an automation around a single trigger (optionally with `for:`). */
function buildAutomation(opts: {
  id?: string;
  status?: "enabled" | "disabled";
  trigger: Partial<Trigger> & { event: string };
  conditions?: unknown[];
  actions?: unknown[];
}): Automation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Dwell test",
    triggers: [opts.trigger],
    conditions: opts.conditions ?? [],
    actions: opts.actions ?? [
      { action: "test.record", config: { value: "fired" } },
    ],
    mode: "single",
    max_runs: 10,
  });
  return {
    id: opts.id ?? "auto-1",
    name: "Dwell test",
    status: opts.status ?? "enabled",
    definition,
    runAs: "app-test",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Minimal in-memory automation store covering the dwell read paths. */
function makeAutomationStore(automations: Automation[]): AutomationStore {
  const byId = new Map(automations.map((a) => [a.id, a]));
  const loaded = (a: Automation): LoadedAutomation => ({
    id: a.id,
    name: a.name,
    status: a.status,
    definition: a.definition,
    runAs: a.runAs ?? null,
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

/** Fake health client returning a fixed status per system. */
function makeHealthClient(statuses: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      getHealthState: async ({ systemId }: { systemId: string }) => {
        calls.push(systemId);
        return {
          status: statuses[systemId] ?? "healthy",
          inStatusSince: new Date(),
          inStatusForMs: 0,
          inMaintenance: false,
          evaluatedAt: new Date(),
        };
      },
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) {
          states[id] = {
            status: statuses[id] ?? "healthy",
            inStatusSince: new Date(),
            inStatusForMs: 0,
            inMaintenance: false,
            evaluatedAt: new Date(),
          };
        }
        return { states };
      },
    } as never,
  };
}

function setup(opts?: { statuses?: Record<string, string> }) {
  const actionsReg = createActionRegistry();
  const rec = makeRecordingAction();
  actionsReg.register(rec.definition, testPlugin);
  const health = makeHealthClient(opts?.statuses ?? { "sys-1": "unhealthy" });
  const { deps, dwells, runs, queue } = makeDispatchDeps({
    actions: actionsReg,
    healthCheckClient: health.client,
  });
  return { deps, dwells, runs, queue, rec, health };
}

describe("armDwell", () => {
  it("arms a dwell row + enqueues a wake job, snapshotting the armed status", async () => {
    const { deps, dwells, queue } = setup();
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });

    await armDwell({
      deps,
      automation,
      trigger: automation.definition.triggers[0]!,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      triggerPayload: { id: "sys-1" },
      actor: SYSTEM_ACTOR,
    });

    expect(dwells.dwells.size).toBe(1);
    const dwell = [...dwells.dwells.values()][0]!;
    expect(dwell.armedStatus).toBe("unhealthy");
    expect(dwell.contextKey).toBe("sys-1");
    // 30 min in the future (allow a small window)
    const deltaMs = dwell.fireAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(29 * 60_000);
    expect(deltaMs).toBeLessThanOrEqual(30 * 60_000 + 1000);
    // a wake job was enqueued with the matching startDelay
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.queue).toBe("automation-dwell");
    expect(queue.jobs[0]?.startDelay).toBe(30 * 60);
  });

  it("re-arm PRESERVES the original fireAt (continuous-since-first-arm), not stacking", async () => {
    // Critical for sustained `for:`: a continuously re-firing trigger
    // (e.g. level-triggered numeric_state every 60s with for: 10m) must
    // NOT keep pushing the deadline, or it would never elapse. The window
    // measures "matched continuously since first arm" (HA semantics).
    const { deps, dwells } = setup();
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const arm = () =>
      armDwell({
        deps,
        automation,
        trigger: automation.definition.triggers[0]!,
        triggerId: "test_event",
        eventId: EVENT,
        contextKey: "sys-1",
        triggerPayload: { id: "sys-1" },
        actor: SYSTEM_ACTOR,
      });

    // Pin the clock so the re-arm happens at a deterministically LATER wall
    // time than the first arm. A real `setTimeout(5)` could elapse as ~0ms
    // under a loaded parallel runner, silently weakening the assertion;
    // advancing a fake clock proves the deadline is preserved regardless.
    const base = Date.now();
    setSystemTime(new Date(base));
    try {
      await arm();
      const first = [...dwells.dwells.values()][0]!;
      const firstFireAt = first.fireAt.getTime();

      // Jump well past the first arm; a recompute would move fireAt by ~1s.
      setSystemTime(new Date(base + 1000));
      await arm();

      expect(dwells.dwells.size).toBe(1); // still one row
      const after = [...dwells.dwells.values()][0]!;
      expect(after.id).toBe(first.id);
      // fireAt UNCHANGED — original deadline preserved despite the clock move.
      expect(after.fireAt.getTime()).toBe(firstFireAt);
    } finally {
      setSystemTime(); // restore the real clock
    }
  });
});

describe("fireDwell", () => {
  it("re-confirms the armed status still holds, then starts the run", async () => {
    const { deps, dwells, rec, runs } = setup({
      statuses: { "sys-1": "unhealthy" },
    });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });

    // dwell row consumed, and the run fired the action
    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.value).toBe("fired");
    expect(runs.runs.size).toBe(1);
  });

  it("does NOT start a run when the system has left the armed status", async () => {
    // armed unhealthy, but the system recovered to healthy by expiry
    const { deps, dwells, rec, runs } = setup({
      statuses: { "sys-1": "healthy" },
    });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });

    expect(dwells.dwells.size).toBe(0); // row still consumed (delete-first)
    expect(rec.calls).toHaveLength(0); // but no run
    expect(runs.runs.size).toBe(0);
  });

  it("drops the dwell without firing when the automation is disabled", async () => {
    const { deps, dwells, rec } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      status: "disabled",
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });

    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });

  it("two concurrent fires of the same dwell start exactly ONE run (atomic claim)", async () => {
    // H1 regression: fireDwell deletes the row FIRST as an atomic claim
    // (DELETE ... RETURNING). Two racing callers (e.g. the queue consumer
    // and the stalled sweeper, or two pods) must not both startRun.
    const { deps, dwells, rec, runs } = setup({
      statuses: { "sys-1": "unhealthy" },
    });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    // Both callers see the same loaded dwell and race to fire it.
    await Promise.all([
      fireDwell({
        deps,
        automationStore: store,
        dwell,
        startRun: startRunRespectingMode,
      }),
      fireDwell({
        deps,
        automationStore: store,
        dwell,
        startRun: startRunRespectingMode,
      }),
    ]);

    expect(dwells.dwells.size).toBe(0);
    // Exactly one winner started a run / fired the action.
    expect(rec.calls).toHaveLength(1);
    expect(runs.runs.size).toBe(1);
  });

  it("degrades a malformed stored actorSnapshot to the system actor instead of crashing (L1)", async () => {
    // A drifted / hand-edited actorSnapshot must not flow through untyped:
    // the load-time parse degrades it to the system actor so the run still
    // fires (dropping a legitimate alert over a bad snapshot would be worse).
    const { deps, rec, runs } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      // Garbage actor snapshot (e.g. a row hand-edited or written by an
      // older/drifted schema).
      actorSnapshot: { type: "bogus", nope: 1 } as unknown as Record<
        string,
        unknown
      >,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });

    // Still fired (degraded gracefully), did not throw.
    expect(rec.calls).toHaveLength(1);
    expect(runs.runs.size).toBe(1);
  });

  it("re-checks pre-run conditions at fire time", async () => {
    // condition references live health; system is healthy so it should NOT fire
    const { deps, rec } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
      conditions: ["health.system.status == 'degraded'"], // never true here
    });
    const store = makeAutomationStore([automation]);

    const { id: dwellId } = await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(),
    });
    const dwell = (await deps.dwellStore.load(dwellId))!;

    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });

    expect(rec.calls).toHaveLength(0);
  });
});

describe("handleTriggerFiring with for: triggers", () => {
  it("arms a dwell instead of starting a run immediately", async () => {
    const { deps, dwells, rec } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: EVENT,
      triggerPayload: { id: "sys-1" },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    expect(dwells.dwells.size).toBe(1);
    expect(rec.calls).toHaveLength(0); // armed, not fired
  });

  it("eagerly cancels a stale dwell when the system leaves the armed status", async () => {
    // arm a dwell while unhealthy...
    const { deps, dwells } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(Date.now() + 30 * 60_000),
    });
    expect(dwells.dwells.size).toBe(1);

    // ...now the system reports healthy and an event fires again
    deps.healthCheckClient = makeHealthClient({ "sys-1": "healthy" }).client;
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: EVENT,
      triggerPayload: { id: "sys-1" },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    // the stale dwell was cancelled; a fresh one was armed (still unhealthy
    // armed-status? no — now healthy, so the fresh arm snapshots "healthy").
    // Either way the original unhealthy-armed dwell is gone.
    const remaining = [...dwells.dwells.values()];
    expect(remaining.every((d) => d.armedStatus !== "unhealthy")).toBe(true);
  });

  it("reads enabled automations ONCE per firing (step 2 + inverse-cancel share the scan)", async () => {
    // The inverse-cancel step (step 3) used to re-issue the same full-table
    // scan of `automations` that step 2 already ran — two scans per firing.
    // This is the case that triggered it: a `for:` trigger (so step 3
    // iterates) with a health client wired and a contextKey set.
    const { deps } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const inner = makeAutomationStore([automation]);
    let findByEventCalls = 0;
    const store: AutomationStore = {
      ...inner,
      findEnabledByTriggerEvent: async (eventId) => {
        findByEventCalls += 1;
        return inner.findEnabledByTriggerEvent(eventId);
      },
    };

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: EVENT,
      triggerPayload: { id: "sys-1" },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    expect(findByEventCalls).toBe(1);
  });

  it("starts a run immediately for a trigger WITHOUT for:", async () => {
    const { deps, dwells, rec } = setup({ statuses: { "sys-1": "unhealthy" } });
    const automation = buildAutomation({ trigger: { event: EVENT } });
    const store = makeAutomationStore([automation]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: EVENT,
      triggerPayload: { id: "sys-1" },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(1);
  });
});

describe("dwell store — keys + sweep", () => {
  it("keeps at most one dwell per (automation, trigger, contextKey)", async () => {
    const { deps, dwells } = setup();
    const base = {
      automationId: "auto-1",
      triggerId: "test_event",
      eventId: EVENT,
      armedStatus: "unhealthy",
      payloadSnapshot: {},
      actorSnapshot: {},
    };
    await deps.dwellStore.arm({
      ...base,
      contextKey: "sys-1",
      fireAt: new Date(),
    });
    await deps.dwellStore.arm({
      ...base,
      contextKey: "sys-1",
      fireAt: new Date(),
    });
    await deps.dwellStore.arm({
      ...base,
      contextKey: "sys-2",
      fireAt: new Date(),
    });
    expect(dwells.dwells.size).toBe(2); // sys-1 deduped, sys-2 distinct
  });

  it("sweepExpired returns only dwells whose fireAt has passed", async () => {
    const { deps } = setup();
    await deps.dwellStore.arm({
      automationId: "auto-1",
      triggerId: "t",
      eventId: EVENT,
      contextKey: "past",
      armedStatus: null,
      payloadSnapshot: {},
      actorSnapshot: {},
      fireAt: new Date(Date.now() - 1000),
    });
    await deps.dwellStore.arm({
      automationId: "auto-1",
      triggerId: "t",
      eventId: EVENT,
      contextKey: "future",
      armedStatus: null,
      payloadSnapshot: {},
      actorSnapshot: {},
      fireAt: new Date(Date.now() + 60_000),
    });
    const expired = await deps.dwellStore.sweepExpired(new Date());
    expect(expired).toHaveLength(1);
    expect(expired[0]?.contextKey).toBe("past");
  });

  it("restart recovery: the sweeper fires an expired dwell whose queue job was lost", async () => {
    const { deps, dwells, rec, runs } = setup({
      statuses: { "sys-1": "unhealthy" },
    });
    const automation = buildAutomation({
      trigger: { event: EVENT, for: { minutes: 30 } },
    });
    const store = makeAutomationStore([automation]);

    // Dwell armed and already past its fireAt — simulating a queue job that
    // never arrived (process restart / Redis loss).
    await deps.dwellStore.arm({
      automationId: automation.id,
      triggerId: "test_event",
      eventId: EVENT,
      contextKey: "sys-1",
      armedStatus: "unhealthy",
      payloadSnapshot: { id: "sys-1" },
      actorSnapshot: SYSTEM_ACTOR as unknown as Record<string, unknown>,
      fireAt: new Date(Date.now() - 1000),
    });

    const sweeper = startStalledSweeper({
      deps,
      automationStore: store,
      logger: deps.logger,
    });
    await sweeper.sweep();
    sweeper.stop();

    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(1);
    expect(runs.runs.size).toBe(1);
  });

  it("deleteForAutomation drops every dwell for the automation", async () => {
    const { deps, dwells } = setup();
    await deps.dwellStore.arm({
      automationId: "auto-1",
      triggerId: "t",
      eventId: EVENT,
      contextKey: "a",
      armedStatus: null,
      payloadSnapshot: {},
      actorSnapshot: {},
      fireAt: new Date(),
    });
    await deps.dwellStore.arm({
      automationId: "auto-2",
      triggerId: "t",
      eventId: EVENT,
      contextKey: "b",
      armedStatus: null,
      payloadSnapshot: {},
      actorSnapshot: {},
      fireAt: new Date(),
    });
    await deps.dwellStore.deleteForAutomation("auto-1");
    expect(dwells.dwells.size).toBe(1);
    expect([...dwells.dwells.values()][0]?.automationId).toBe("auto-2");
  });
});

describe("numeric_state trigger + for: via handleTriggerFiring", () => {
  const NUMERIC_EVENT = "test.numeric_state";

  function setupNumeric() {
    const triggers = createTriggerRegistry();
    triggers.register(
      // re-id the built-in numeric_state under the `test` plugin so the
      // registered qualifiedId matches the automation's trigger event.
      {
        ...createNumericStateTrigger(),
        id: "numeric_state",
      } as unknown as TriggerDefinition<unknown, unknown>,
      testPlugin,
    );
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, dwells, runs } = makeDispatchDeps({
      actions: actionsReg,
      triggers,
    });
    return { deps, dwells, runs, rec };
  }

  function numericAutomation(forDwell: boolean): Automation {
    const trigger: Record<string, unknown> = {
      event: NUMERIC_EVENT,
      config: { field: "latencyMs", above: 500 },
    };
    if (forDwell) trigger.for = { minutes: 30 };
    const definition = AutomationDefinitionSchema.parse({
      name: "Numeric",
      triggers: [trigger],
      conditions: [],
      actions: [{ action: "test.record", config: { value: "fired" } }],
      mode: "single",
      max_runs: 10,
    });
    return {
      id: "auto-num",
      name: "Numeric",
      status: "enabled",
      definition,
      runAs: "app-test",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("arms a dwell only when the numeric threshold crosses (with for:)", async () => {
    const { deps, dwells, rec } = setupNumeric();
    const store = makeAutomationStore([numericAutomation(true)]);

    // Below threshold → no arm.
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: NUMERIC_EVENT,
      triggerPayload: {
        systemId: "sys-1",
        configurationId: "c",
        status: "healthy",
        latencyMs: 100,
      },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });
    expect(dwells.dwells.size).toBe(0);

    // Above threshold → arm.
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: NUMERIC_EVENT,
      triggerPayload: {
        systemId: "sys-1",
        configurationId: "c",
        status: "degraded",
        latencyMs: 600,
      },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });
    expect(dwells.dwells.size).toBe(1);
    expect(rec.calls).toHaveLength(0); // armed, not fired
  });

  it("starts a run immediately when the threshold crosses without for:", async () => {
    const { deps, dwells, rec } = setupNumeric();
    const store = makeAutomationStore([numericAutomation(false)]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: NUMERIC_EVENT,
      triggerPayload: {
        systemId: "sys-1",
        configurationId: "c",
        status: "degraded",
        latencyMs: 600,
      },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.value).toBe("fired");
  });

  it("does not fire below the threshold (no dwell)", async () => {
    const { deps, dwells, rec } = setupNumeric();
    const store = makeAutomationStore([numericAutomation(false)]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: NUMERIC_EVENT,
      triggerPayload: {
        systemId: "sys-1",
        configurationId: "c",
        status: "healthy",
        latencyMs: 100,
      },
      actor: SYSTEM_ACTOR,
      contextKey: "sys-1",
    });

    expect(dwells.dwells.size).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });

  it("headline: repeated above-threshold firings fire the dwell exactly ONCE at first_arm + duration, not pushed indefinitely", async () => {
    // The bug this guards: a level-triggered numeric_state fires on EVERY
    // check completion above threshold (e.g. every 60s). With for: 10m,
    // re-arming must NOT push fireAt forward, or the window never elapses.
    const { deps, dwells, rec, runs } = setupNumeric();
    const store = makeAutomationStore([numericAutomation(true)]);

    const fireOnce = () =>
      handleTriggerFiring({
        deps,
        automationStore: store,
        qualifiedEventId: NUMERIC_EVENT,
        triggerPayload: {
          systemId: "sys-1",
          configurationId: "c",
          status: "degraded",
          latencyMs: 600,
        },
        actor: SYSTEM_ACTOR,
        contextKey: "sys-1",
      });

    // First above-threshold completion arms the dwell.
    await fireOnce();
    expect(dwells.dwells.size).toBe(1);
    const armed = [...dwells.dwells.values()][0]!;
    const originalFireAt = armed.fireAt.getTime();

    // Many more above-threshold completions arrive within the window. Each
    // re-arm is a continuation and must preserve the original deadline.
    for (let i = 0; i < 20; i++) {
      await fireOnce();
    }
    expect(dwells.dwells.size).toBe(1);
    expect([...dwells.dwells.values()][0]!.fireAt.getTime()).toBe(
      originalFireAt,
    );
    expect(rec.calls).toHaveLength(0); // still dwelling, no run yet

    // Simulate the window elapsing (fireAt now in the past) and the
    // sweeper picking up the expired dwell.
    [...dwells.dwells.values()][0]!.fireAt = new Date(Date.now() - 1000);
    const sweeper = startStalledSweeper({
      deps,
      automationStore: store,
      logger: deps.logger,
    });
    await sweeper.sweep();
    sweeper.stop();

    // Fired exactly once; dwell consumed.
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.value).toBe("fired");
    expect(runs.runs.size).toBe(1);
    expect(dwells.dwells.size).toBe(0);
  });
});
