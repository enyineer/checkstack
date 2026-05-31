/**
 * End-to-end test of the Phase 20 default auto-incident automation:
 * sustained-unhealthy -> dwell -> incident.create -> wait_until(healthy
 * for cooldown) -> incident.resolve. Exercises the real dispatch engine,
 * dwell, and wait_until machinery with in-memory stores + mock incident
 * actions, driving the same flow the seeded default automation runs.
 */
import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  AutomationDefinitionSchema,
  type Automation,
} from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import type { ActionDefinition } from "../action-types";
import { createActionRegistry } from "../action-registry";
import { handleTriggerFiring, startRunRespectingMode } from "./trigger-subscriber";
import { fireDwell } from "./dwell";
import { checkWaitUntil } from "./engine";
import { makeDispatchDeps, testPlugin } from "./test-fixtures";
import { buildSustainedAutomation } from "../migration/from-auto-incident-policies";
import type { LoadedAutomation } from "./types";

const SYS = "sys-1";

/** Mutable health client: flip the system's status between checks. */
function mutableHealth(initial: string) {
  const state = { status: initial, since: new Date(Date.now() - 60_000) };
  const snap = () => ({
    status: state.status,
    inStatusSince: state.since,
    inStatusForMs: Date.now() - state.since.getTime(),
    inMaintenance: false,
    transitionsInWindow: 0,
    transitionWindowMinutes: 60,
    evaluatedAt: new Date(),
  });
  return {
    set: (status: string, sinceMsAgo: number) => {
      state.status = status;
      state.since = new Date(Date.now() - sinceMsAgo);
    },
    client: {
      getHealthState: async () => snap(),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) states[id] = snap();
        return { states };
      },
    } as never,
  };
}

/**
 * Mock incident.create (produces "incident") + incident.resolve
 * (consumes). Faithfully models the real `dedupe_open_for_system` flag
 * against a shared per-system open-incident map, so the E2E proves the
 * per-system dedup semantic end to end.
 */
function incidentActions(opened: string[], resolved: string[]) {
  // systemId -> open incidentId (cleared on resolve).
  const openBySystem = new Map<string, string>();
  let counter = 0;

  const create: ActionDefinition<
    { systemIds: string[]; dedupe_open_for_system?: boolean },
    { incidentId: string }
  > = {
    id: "create",
    displayName: "Create Incident",
    config: new Versioned({
      version: 1,
      schema: z.object({ systemIds: z.array(z.string()) }).passthrough(),
    }),
    produces: "incident",
    execute: async ({ config }) => {
      const systemId = config.systemIds[0] ?? "?";
      if (config.dedupe_open_for_system) {
        const existing = openBySystem.get(systemId);
        if (existing) {
          // Reuse the open incident — no new open recorded.
          return {
            success: true,
            externalId: existing,
            artifact: { incidentId: existing },
          };
        }
      }
      const incidentId = `INC-${++counter}`;
      openBySystem.set(systemId, incidentId);
      opened.push(systemId);
      return { success: true, externalId: incidentId, artifact: { incidentId } };
    },
  };
  const resolve: ActionDefinition<{ incidentId?: string }, unknown> = {
    id: "resolve",
    displayName: "Resolve Incident",
    config: new Versioned({
      version: 1,
      schema: z.object({ incidentId: z.string().optional() }).passthrough(),
    }),
    consumes: ["incident"],
    execute: async ({ config, consumedArtifacts }) => {
      const incident = consumedArtifacts["incident"] as
        | { incidentId: string }
        | undefined;
      const id = config.incidentId ?? incident?.incidentId;
      if (!id) return { success: false, error: "no incident to resolve" };
      resolved.push(id);
      for (const [sys, inc] of openBySystem) {
        if (inc === id) openBySystem.delete(sys);
      }
      return { success: true, externalId: id };
    },
  };
  return [
    create as ActionDefinition<unknown, unknown>,
    resolve as ActionDefinition<unknown, unknown>,
  ];
}

function buildAuto(id = "auto-1", configId = "cfg-1"): Automation {
  // Reuse the real migration builder so the E2E exercises the shipped
  // default automation shape, but point the action ids at the test plugin.
  const def = buildSustainedAutomation({
    systemId: SYS,
    configurationId: configId,
    configurationName: configId,
    policy: {
      autoOpenIncidentOnUnhealthy: true,
      useNotificationSuppression: true,
      skipDuringMaintenance: true,
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 30 },
      flappingTrigger: { enabled: true, transitions: 3, windowMinutes: 60 },
      autoCloseAfterMinutes: 30,
    },
  })!;
  // Re-point incident.create/resolve → test.create/resolve.
  const json = JSON.parse(
    JSON.stringify(def).replaceAll('"incident.', '"test.'),
  );
  const definition = AutomationDefinitionSchema.parse(json);
  return {
    id,
    name: def.name,
    status: "enabled",
    definition,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStore(autos: Automation[]): AutomationStore {
  const byId = new Map(autos.map((a) => [a.id, a]));
  const loaded = (a: Automation): LoadedAutomation => ({
    id: a.id,
    name: a.name,
    status: a.status,
    definition: a.definition,
  });
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
      const a = byId.get(id);
      return a ? { ...a, description: a.definition.description } : undefined;
    },
    list: async () => ({ items: [...byId.values()], total: byId.size }),
    findEnabledByTriggerEvent: async () =>
      [...byId.values()].map((a) => loaded(a)),
    listEnabled: async () => [...byId.values()].map((a) => loaded(a)),
  };
}

describe("Phase 20 default auto-incident automation (E2E)", () => {
  it("sustained unhealthy → opens; healthy for cooldown → resolves", async () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const actionsReg = createActionRegistry();
    for (const a of incidentActions(opened, resolved)) {
      actionsReg.register(a, testPlugin);
    }
    // Unhealthy for 40 min (> 30 min dwell + re-confirm).
    const health = mutableHealth("unhealthy");
    health.set("unhealthy", 40 * 60_000);
    const { deps, dwells, runs } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: health.client,
    });
    const auto = buildAuto();
    const store = makeStore([auto]);

    // 1) system_degraded fires → arms the dwell (no run yet).
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.system_degraded",
      triggerPayload: { systemId: SYS, systemName: "API", newStatus: "unhealthy" },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });
    expect(dwells.dwells.size).toBe(1);
    expect(opened).toHaveLength(0);

    // 2) Dwell expires; still unhealthy → fires → opens incident, then
    //    suspends on wait_until (system not yet healthy-for-cooldown).
    const dwell = [...dwells.dwells.values()][0]!;
    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });
    expect(opened).toEqual([SYS]);
    expect(resolved).toHaveLength(0);
    // The run is suspended on the wait_until (an `until` wait lock exists).
    const untilLock = [...runs.waitLocks.values()].find((l) => l.kind === "until");
    expect(untilLock).toBeDefined();

    // 3) System recovers and stays healthy past the cooldown.
    health.set("healthy", 31 * 60_000);
    const runId = untilLock!.runId;
    const outcome = await checkWaitUntil(deps, {
      runId,
      waitLockId: untilLock!.id,
      automation: {
        id: auto.id,
        name: auto.name,
        status: auto.status,
        definition: auto.definition,
      },
    });
    expect(outcome).toBe("resumed");
    // The incident opened in step 2 is resolved, consuming its artifact.
    expect(resolved).toEqual(["INC-1"]);
    expect(runs.runs.get(runId)?.status).toBe("success");
  });

  it("recovery before the dwell elapses → no incident opened", async () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const actionsReg = createActionRegistry();
    for (const a of incidentActions(opened, resolved)) {
      actionsReg.register(a, testPlugin);
    }
    const health = mutableHealth("unhealthy");
    health.set("unhealthy", 40 * 60_000);
    const { deps, dwells } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: health.client,
    });
    const auto = buildAuto();
    const store = makeStore([auto]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.system_degraded",
      triggerPayload: { systemId: SYS, systemName: "API" },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });
    const dwell = [...dwells.dwells.values()][0]!;

    // System recovered before the dwell fired → re-confirm fails → no open.
    health.set("healthy", 5 * 60_000);
    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });
    expect(opened).toHaveLength(0);
  });

  it("maintenance suppresses the open even after the dwell fires", async () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const actionsReg = createActionRegistry();
    for (const a of incidentActions(opened, resolved)) {
      actionsReg.register(a, testPlugin);
    }
    // Unhealthy + IN maintenance: the maintenance condition gates the run.
    const state = {
      status: "unhealthy",
      since: new Date(Date.now() - 40 * 60_000),
    };
    const client = {
      getHealthState: async () => ({
        status: state.status,
        inStatusSince: state.since,
        inStatusForMs: Date.now() - state.since.getTime(),
        inMaintenance: true,
        transitionsInWindow: 0,
        transitionWindowMinutes: 60,
        evaluatedAt: new Date(),
      }),
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        const states: Record<string, unknown> = {};
        for (const id of systemIds) {
          states[id] = {
            status: state.status,
            inStatusSince: state.since,
            inStatusForMs: Date.now() - state.since.getTime(),
            inMaintenance: true,
            transitionsInWindow: 0,
            transitionWindowMinutes: 60,
            evaluatedAt: new Date(),
          };
        }
        return { states };
      },
    } as never;
    const { deps, dwells } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: client,
    });
    const auto = buildAuto();
    const store = makeStore([auto]);

    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.system_degraded",
      triggerPayload: { systemId: SYS, systemName: "API" },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });
    const dwell = [...dwells.dwells.values()][0]!;
    await fireDwell({
      deps,
      automationStore: store,
      dwell,
      startRun: startRunRespectingMode,
    });
    // The maintenance pre-run condition (!health.system.in_maintenance)
    // is false → the run never reaches incident.create.
    expect(opened).toHaveLength(0);
  });

  it("two checks on one system both degrading open EXACTLY ONE incident (per-system dedup)", async () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const actionsReg = createActionRegistry();
    for (const a of incidentActions(opened, resolved)) {
      actionsReg.register(a, testPlugin);
    }
    const health = mutableHealth("unhealthy");
    health.set("unhealthy", 40 * 60_000);
    const { deps, dwells } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: health.client,
    });
    // Two sustained automations for the same system, one per check.
    const autoA = buildAuto("auto-A", "cfg-A");
    const autoB = buildAuto("auto-B", "cfg-B");
    const store = makeStore([autoA, autoB]);

    // A single system_degraded event arms BOTH automations' dwells (each
    // is keyed per automation, so two dwells).
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.system_degraded",
      triggerPayload: { systemId: SYS, systemName: "API" },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });
    expect(dwells.dwells.size).toBe(2);

    // Fire both dwells (both still unhealthy → both run). The first opens
    // the incident; the second dedupes to it.
    for (const dwell of [...dwells.dwells.values()]) {
      await fireDwell({
        deps,
        automationStore: store,
        dwell,
        startRun: startRunRespectingMode,
      });
    }

    // Exactly one incident opened for the system, despite two checks.
    expect(opened).toEqual([SYS]);
  });

  it("a flapping check while a sustained incident is open does NOT open a second", async () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const actionsReg = createActionRegistry();
    for (const a of incidentActions(opened, resolved)) {
      actionsReg.register(a, testPlugin);
    }
    const health = mutableHealth("unhealthy");
    health.set("unhealthy", 40 * 60_000);
    const { deps, dwells } = makeDispatchDeps({
      actions: actionsReg,
      healthCheckClient: health.client,
    });

    // Sustained automation opens the incident first.
    const sustained = buildAuto("auto-sustained", "cfg-1");
    // A flapping automation (dedupe on) for the same system.
    const flapDef = AutomationDefinitionSchema.parse(
      JSON.parse(
        JSON.stringify({
          name: "flap",
          triggers: [
            {
              event: "healthcheck.flapping_detected",
              filter: `trigger.payload.systemId == "${SYS}"`,
            },
          ],
          conditions: ["!health.system.in_maintenance"],
          actions: [
            {
              id: "open_incident",
              action: "test.create",
              config: {
                title: "flap",
                severity: "critical",
                systemIds: ["{{ trigger.payload.systemId }}"],
                dedupe_open_for_system: true,
              },
            },
          ],
          mode: "single",
          concurrency_scope: "context_key",
          max_runs: 1,
        }),
      ),
    );
    const flapping: Automation = {
      id: "auto-flap",
      name: "flap",
      status: "enabled",
      definition: flapDef,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = makeStore([sustained, flapping]);

    // Sustained opens (via the dwell).
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.system_degraded",
      triggerPayload: { systemId: SYS, systemName: "API" },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });
    for (const dwell of [...dwells.dwells.values()]) {
      await fireDwell({
        deps,
        automationStore: store,
        dwell,
        startRun: startRunRespectingMode,
      });
    }
    expect(opened).toEqual([SYS]);

    // Now a check flaps → flapping automation fires → dedupes to the open.
    await handleTriggerFiring({
      deps,
      automationStore: store,
      qualifiedEventId: "healthcheck.flapping_detected",
      triggerPayload: {
        systemId: SYS,
        configurationId: "cfg-2",
        transitionCount: 3,
        windowMinutes: 60,
      },
      actor: SYSTEM_ACTOR,
      contextKey: SYS,
    });

    // Still exactly one incident for the system.
    expect(opened).toEqual([SYS]);
  });
});
