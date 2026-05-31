/**
 * Reactive `wait_until` wake re-evaluation for NON-health entity kinds
 * (reactive automation engine §3.6, §8). A wait whose condition reads
 * `state.<kind>.<id>` must, on wake, re-enrich scope with that entity kind
 * resolved KIND-AGNOSTICALLY through the entity store — not only health.
 * Otherwise a Phase-4 entity (incident, slo, …) wait can never resolve true
 * and the run waits until timeout (the latent bug this guards against).
 */
import { describe, it, expect } from "bun:test";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createActionRegistry } from "../action-registry";
import { dispatchTrigger } from "./engine";
import { handleDispatchJob } from "./stage2-dispatch";
import { routeEntityChange } from "./stage1-router";
import { createChangeDeriverRegistry } from "../entity/change-derivers";
import {
  makeDispatchDeps,
  makeRecordingAction,
  testPlugin,
} from "./test-fixtures";
import type { DispatchDeps } from "./types";
import type { LoadedAutomation } from "./types";
import type { AutomationStore } from "../automation-store";

/**
 * An in-memory entity store for ONE non-health kind, exposing a
 * kind-agnostic resolver (`getMany`-style) + a setter so a test can mutate
 * the entity between suspend and wake.
 */
function fakeIncidentEntities(kind: string) {
  const rows = new Map<string, Record<string, unknown>>();
  const resolverFor: DispatchDeps["entityResolverFor"] = (k) => {
    if (k !== kind) return undefined;
    return async (ids) => {
      const out: Record<string, Record<string, unknown>> = {};
      for (const id of ids) {
        const row = rows.get(id);
        if (row) out[id] = row;
      }
      return out;
    };
  };
  return {
    set: (id: string, state: Record<string, unknown>) => rows.set(id, state),
    resolverFor,
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

function incidentChange(id: string, status: string): EntityChanged {
  return {
    kind: "incident",
    id,
    prev: { status: "open" },
    next: { status },
    delta: { status },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * A per-system mutable health client. Tracks which system ids were requested
 * via `getBulkHealthState` so a test can assert the changed system was fed in.
 */
function perSystemHealthClient(initial: Record<string, string>) {
  const statuses = new Map<string, string>(Object.entries(initial));
  const requested: string[] = [];
  const stateObj = (status: string) => ({
    status,
    inStatusSince: new Date(),
    inStatusForMs: 0,
    inMaintenance: false,
    evaluatedAt: new Date(),
  });
  return {
    set: (id: string, status: string) => statuses.set(id, status),
    requestedIds: () => requested,
    client: {
      getHealthState: async () => stateObj("healthy"),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) {
          requested.push(id);
          states[id] = stateObj(statuses.get(id) ?? "unknown");
        }
        return { states };
      },
    } as never,
  };
}

function healthChange(id: string, status: string): EntityChanged {
  return {
    kind: "health",
    id,
    prev: { status: "unhealthy" },
    next: { status },
    delta: { status },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
  };
}

describe("wait_until — wildcard health wake drops nothing (§Fix 2)", () => {
  it("a health:* wait woken by a non-context system resumes (changed system is resolved)", async () => {
    // The condition reads a DYNAMIC health system id (from the payload), so
    // ref extraction yields the health WILDCARD `health:*`. The wait is woken
    // by `health:sys-other`, which is NEITHER the contextKey NOR listed in
    // `uses_state`. The fix injects the changed system into the health
    // resolution so `scope.health.systems[sys-other]` is populated and the
    // condition can become true.
    const health = perSystemHealthClient({
      "sys-ctx": "healthy",
      "sys-other": "unhealthy",
    });

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions,
      healthCheckClient: health.client,
    });

    const auto = automation([
      {
        wait_until: {
          // Dynamic system id → extraction can only record `health:*`.
          condition:
            "health.systems[trigger.payload.target].status == 'healthy'",
        },
      },
      { action: "test.record", config: { value: "recovered" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      // contextKey is sys-ctx; the watched system is sys-other.
      payload: { id: "sys-ctx", target: "sys-other" },
      contextKey: "sys-ctx",
    });
    expect(result.status).toBe("waiting");

    const lock = [...runs.waitLocks.values()][0]!;
    expect([...(runs.wakeRefs.get(lock.id) ?? [])]).toEqual(["health:*"]);

    // sys-other recovers; the wildcard wake matches.
    health.set("sys-other", "healthy");
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: healthChange("sys-other", "healthy"),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");
    expect(jobs[0]?.ref).toBe("health:sys-other");

    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: jobs[0]! });

    // Resumed: without the fix, sys-other would never be resolved into
    // scope.health.systems and the run would stay waiting.
    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["recovered"]);
    expect(runs.waitLocks.size).toBe(0);
    // The changed (non-context) system was actually fed into health resolution.
    expect(health.requestedIds()).toContain("sys-other");
  });
});

describe("wait_until — non-health entity-kind wake re-eval", () => {
  it("wakes on an incident change, re-enriches state.incident.*, and resumes", async () => {
    const incidents = fakeIncidentEntities("incident");
    // The incident starts open (condition false at suspend time).
    incidents.set("inc-1", { status: "open" });

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions,
      entityResolverFor: incidents.resolverFor,
    });

    const auto = automation([
      { wait_until: { condition: "state.incident['inc-1'].status == 'resolved'" } },
      { action: "test.record", config: { value: "closed" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "inc-1" },
      contextKey: "inc-1",
    });
    // Suspends: state.incident isn't in the initial (health-only) scope.
    expect(result.status).toBe("waiting");
    expect(runs.waitLocks.size).toBe(1);
    expect(rec.calls).toHaveLength(0);

    // The wake-index recorded the concrete incident ref.
    const lock = [...runs.waitLocks.values()][0]!;
    expect([...(runs.wakeRefs.get(lock.id) ?? [])]).toEqual(["incident:inc-1"]);

    // The incident resolves; an ENTITY_CHANGED routes a Stage-2 wake.
    incidents.set("inc-1", { status: "resolved" });
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: incidentChange("inc-1", "resolved"),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");

    // Run the wake job: re-enrich state.incident.inc-1 (now resolved) → resume.
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: jobs[0]! });

    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["closed"]);
    expect(runs.waitLocks.size).toBe(0);
  });

  it("does NOT resume while the entity still fails the condition", async () => {
    const incidents = fakeIncidentEntities("incident");
    incidents.set("inc-1", { status: "open" });

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions,
      entityResolverFor: incidents.resolverFor,
    });

    const auto = automation([
      { wait_until: { condition: "state.incident['inc-1'].status == 'resolved'" } },
      { action: "test.record", config: { value: "closed" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "inc-1" },
      contextKey: "inc-1",
    });
    expect(result.status).toBe("waiting");

    // The incident merely updates (still open) → wake re-evals false.
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: incidentChange("inc-1", "open"),
    });
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: jobs[0]! });

    expect(runs.runs.get(result.runId)?.status).toBe("waiting");
    expect(rec.calls).toHaveLength(0);
    expect(runs.waitLocks.size).toBe(1);
  });

  it("resolves a wildcard wait via the changedRef (dynamic id)", async () => {
    const incidents = fakeIncidentEntities("incident");

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions,
      entityResolverFor: incidents.resolverFor,
    });

    // Dynamic id: the condition reads the incident id from the trigger
    // payload, so extraction yields the kind WILDCARD `incident:*`.
    const auto = automation([
      {
        wait_until: {
          condition:
            "state.incident[trigger.payload.incidentId].status == 'resolved'",
        },
      },
      { action: "test.record", config: { value: "closed" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { incidentId: "inc-9" },
      contextKey: "inc-9",
    });
    expect(result.status).toBe("waiting");

    const lock = [...runs.waitLocks.values()][0]!;
    expect([...(runs.wakeRefs.get(lock.id) ?? [])]).toEqual(["incident:*"]);

    // The specific incident resolves; the wildcard wake matches and the
    // changedRef drives resolution of the (otherwise un-extractable) id.
    incidents.set("inc-9", { status: "resolved" });
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: incidentChange("inc-9", "resolved"),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reason).toBe("wake");
    expect(jobs[0]?.ref).toBe("incident:inc-9");

    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: jobs[0]! });

    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["closed"]);
  });

  it("a wait combining health AND an incident ref keeps both working", async () => {
    const incidents = fakeIncidentEntities("incident");
    incidents.set("inc-1", { status: "open" });

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);

    // Health client reporting healthy.
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

    const { deps, runs } = makeDispatchDeps({
      actions,
      healthCheckClient: healthClient,
      entityResolverFor: incidents.resolverFor,
    });

    // Both refs must hold. Health is already healthy; the incident gates it.
    const auto = automation([
      {
        wait_until: {
          condition:
            "health.system.status == 'healthy' && state.incident['inc-1'].status == 'resolved'",
        },
      },
      { action: "test.record", config: { value: "done" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    // Health true but incident still open → suspends.
    expect(result.status).toBe("waiting");

    const lock = [...runs.waitLocks.values()][0]!;
    // Both refs recorded (health wildcard from `health.system` + the incident).
    expect([...(runs.wakeRefs.get(lock.id) ?? [])].toSorted()).toEqual([
      "health:*",
      "incident:inc-1",
    ]);

    // Resolve the incident → wake re-evals BOTH (health stays healthy).
    incidents.set("inc-1", { status: "resolved" });
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: incidentChange("inc-1", "resolved"),
    });
    const wake = jobs.find((j) => j.reason === "wake")!;
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: wake });

    expect(runs.runs.get(result.runId)?.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["done"]);
  });

  it("resolves health once per wake — the rich RPC path, never the entity resolver", async () => {
    // Health has a registered entity resolver (it is a real `defineEntity`
    // kind). The wait re-enrichment must STILL resolve health only through
    // the rich `getBulkHealthState` RPC and EXCLUDE the health kind from the
    // entity-store pass, so health is never round-tripped twice per wake.
    const incidents = fakeIncidentEntities("incident");
    incidents.set("inc-1", { status: "open" });

    const actions = createActionRegistry();
    const rec = makeRecordingAction();
    actions.register(rec.definition, testPlugin);

    let bulkHealthCalls = 0;
    let healthEntityResolverCalls = 0;
    const healthClient = {
      getHealthState: async () => ({
        status: "healthy",
        inStatusSince: new Date(),
        inStatusForMs: 0,
        inMaintenance: false,
        evaluatedAt: new Date(),
      }),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        bulkHealthCalls += 1;
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

    // A resolver that ALSO knows the health kind — if the entity pass ever
    // asked for health, this counter would tick (it must not).
    const resolverFor: DispatchDeps["entityResolverFor"] = (k) => {
      if (k === "health") {
        return async (ids) => {
          healthEntityResolverCalls += 1;
          const out: Record<string, Record<string, unknown>> = {};
          for (const id of ids) {
            out[id] = { status: "healthy", healthyChecks: 1, totalChecks: 1 };
          }
          return out;
        };
      }
      return incidents.resolverFor?.(k);
    };

    const { deps, runs } = makeDispatchDeps({
      actions,
      healthCheckClient: healthClient,
      entityResolverFor: resolverFor,
    });

    const auto = automation([
      {
        wait_until: {
          condition:
            "health.system.status == 'healthy' && state.incident['inc-1'].status == 'resolved'",
        },
      },
      { action: "test.record", config: { value: "ok" } },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "sys-1" },
      contextKey: "sys-1",
    });
    expect(result.status).toBe("waiting");

    const bulkAfterDispatch = bulkHealthCalls;

    incidents.set("inc-1", { status: "resolved" });
    const jobs = await routeEntityChange({
      deps,
      automationStore: storeFor(auto),
      changeDerivers: createChangeDeriverRegistry(),
      changed: incidentChange("inc-1", "resolved"),
    });
    const wake = jobs.find((j) => j.reason === "wake")!;
    await handleDispatchJob({ deps, automationStore: storeFor(auto), changeDerivers: createChangeDeriverRegistry(), job: wake });

    expect(runs.runs.get(result.runId)?.status).toBe("success");
    // Health went through the rich RPC path on the wake re-eval...
    expect(bulkHealthCalls).toBeGreaterThan(bulkAfterDispatch);
    // ...and NEVER through the entity-store resolver — resolved once per build.
    expect(healthEntityResolverCalls).toBe(0);
  });
});
