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

/** Mock incident.create (produces "incident") + incident.resolve (consumes). */
function incidentActions(opened: string[], resolved: string[]) {
  const create: ActionDefinition<{ systemIds: string[] }, { incidentId: string }> = {
    id: "create",
    displayName: "Create Incident",
    config: new Versioned({
      version: 1,
      schema: z.object({ systemIds: z.array(z.string()) }).passthrough(),
    }),
    produces: "incident",
    execute: async ({ config }) => {
      const incidentId = `INC-${opened.length + 1}`;
      opened.push(config.systemIds[0] ?? "?");
      return {
        success: true,
        externalId: incidentId,
        artifact: { incidentId },
      };
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
      return { success: true, externalId: id };
    },
  };
  return [
    create as ActionDefinition<unknown, unknown>,
    resolve as ActionDefinition<unknown, unknown>,
  ];
}

function buildAuto(): Automation {
  // Reuse the real migration builder so the E2E exercises the shipped
  // default automation shape, but point the action ids at the test plugin.
  const def = buildSustainedAutomation({
    systemId: SYS,
    configurationId: "cfg-1",
    configurationName: "API",
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
    id: "auto-1",
    name: def.name,
    status: "enabled",
    definition,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStore(auto: Automation): AutomationStore {
  const loaded: LoadedAutomation = {
    id: auto.id,
    name: auto.name,
    status: auto.status,
    definition: auto.definition,
  };
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
        ? { ...auto, description: auto.definition.description }
        : undefined,
    list: async () => ({ items: [auto], total: 1 }),
    findEnabledByTriggerEvent: async () => [loaded],
    listEnabled: async () => [loaded],
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
    const store = makeStore(auto);

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
    const store = makeStore(auto);

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
    const store = makeStore(auto);

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
});
