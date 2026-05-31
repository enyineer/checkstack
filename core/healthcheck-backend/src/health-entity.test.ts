import { describe, it, expect } from "bun:test";
import type {
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  HEALTH_ENTITY_KIND,
  HEALTH_TRIGGER_EVENTS,
  HealthEntityStateSchema,
  classifyHealthChange,
  deriveHealthTriggerEvents,
  mirrorHealthEntity,
  type HealthEntityState,
} from "./health-entity";
import {
  systemDegradedTrigger,
  systemHealthyTrigger,
  systemHealthChangedTrigger,
} from "./automations";

const HEALTHCHECK_PLUGIN_ID = "healthcheck";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: HEALTH_ENTITY_KIND,
    id: "sys-1",
    prev: { status: "healthy", healthyChecks: 2, totalChecks: 2 },
    next: { status: "unhealthy", healthyChecks: 0, totalChecks: 2 },
    delta: { status: "unhealthy", healthyChecks: 0 },
    changedFields: ["status", "healthyChecks"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("HEALTH_TRIGGER_EVENTS (must equal the trigger qualifiedIds)", () => {
  it("emits the underscore trigger qualifiedIds, not the dotted hook ids", () => {
    // Stage-1 routing fires automations on `t.event === trigger.qualifiedId`
    // (`${pluginId}.${trigger.id}`). The healthcheck triggers have ids
    // `system_degraded` / `system_healthy` / `system_health_changed`, so the
    // deriver MUST emit these — NOT the dotted hook ids.
    expect(HEALTH_TRIGGER_EVENTS.degraded).toBe("healthcheck.system_degraded");
    expect(HEALTH_TRIGGER_EVENTS.healthy).toBe("healthcheck.system_healthy");
    expect(HEALTH_TRIGGER_EVENTS.healthChanged).toBe(
      "healthcheck.system_health_changed",
    );
  });

  it("matches the registered trigger qualifiedIds exactly", () => {
    // Compare as plain strings (the constants are narrow literal types).
    expect(`${HEALTHCHECK_PLUGIN_ID}.${systemDegradedTrigger.id}`).toBe(
      HEALTH_TRIGGER_EVENTS.degraded,
    );
    expect(`${HEALTHCHECK_PLUGIN_ID}.${systemHealthyTrigger.id}`).toBe(
      HEALTH_TRIGGER_EVENTS.healthy,
    );
    expect(`${HEALTHCHECK_PLUGIN_ID}.${systemHealthChangedTrigger.id}`).toBe(
      HEALTH_TRIGGER_EVENTS.healthChanged,
    );
  });
});

describe("deriveHealthTriggerEvents", () => {
  it("maps a healthy → unhealthy transition to degraded + umbrella", () => {
    const events = deriveHealthTriggerEvents(change());
    expect(events).toEqual([
      HEALTH_TRIGGER_EVENTS.degraded,
      HEALTH_TRIGGER_EVENTS.healthChanged,
    ]);
  });

  it("maps a degraded → healthy recovery to healthy + umbrella", () => {
    const events = deriveHealthTriggerEvents(
      change({
        prev: { status: "degraded", healthyChecks: 1, totalChecks: 2 },
        next: { status: "healthy", healthyChecks: 2, totalChecks: 2 },
      }),
    );
    expect(events).toEqual([
      HEALTH_TRIGGER_EVENTS.healthy,
      HEALTH_TRIGGER_EVENTS.healthChanged,
    ]);
  });

  it("maps a degraded → unhealthy transition to umbrella only (no directional)", () => {
    const events = deriveHealthTriggerEvents(
      change({
        prev: { status: "degraded", healthyChecks: 1, totalChecks: 2 },
        next: { status: "unhealthy", healthyChecks: 0, totalChecks: 2 },
      }),
    );
    // Neither side is "healthy", so only the umbrella fires.
    expect(events).toEqual([HEALTH_TRIGGER_EVENTS.healthChanged]);
  });

  it("fires nothing on create (prev === null)", () => {
    expect(deriveHealthTriggerEvents(change({ prev: null }))).toEqual([]);
  });

  it("fires nothing on tombstone (next === null)", () => {
    expect(deriveHealthTriggerEvents(change({ next: null }))).toEqual([]);
  });

  it("fires nothing when only non-status fields changed", () => {
    expect(
      deriveHealthTriggerEvents(
        change({
          prev: { status: "healthy", healthyChecks: 2, totalChecks: 2 },
          next: { status: "healthy", healthyChecks: 1, totalChecks: 2 },
        }),
      ),
    ).toEqual([]);
  });
});

describe("classifyHealthChange (cross-plugin consumer predicate)", () => {
  it("flags degraded on healthy → unhealthy (the old systemDegraded condition)", () => {
    const c = classifyHealthChange(change());
    expect(c).toEqual({
      systemId: "sys-1",
      previousStatus: "healthy",
      newStatus: "unhealthy",
      degraded: true,
      recovered: false,
    });
  });

  it("flags recovered on degraded → healthy (the old systemHealthy condition)", () => {
    const c = classifyHealthChange(
      change({
        prev: { status: "degraded", healthyChecks: 1, totalChecks: 2 },
        next: { status: "healthy", healthyChecks: 2, totalChecks: 2 },
      }),
    );
    expect(c.recovered).toBe(true);
    expect(c.degraded).toBe(false);
  });

  it("flags neither on a non-healthy ↔ non-healthy transition", () => {
    const c = classifyHealthChange(
      change({
        prev: { status: "degraded", healthyChecks: 1, totalChecks: 2 },
        next: { status: "unhealthy", healthyChecks: 0, totalChecks: 2 },
      }),
    );
    expect(c.degraded).toBe(false);
    expect(c.recovered).toBe(false);
  });

  it("flags neither on create / tombstone", () => {
    expect(classifyHealthChange(change({ prev: null })).degraded).toBe(false);
    expect(classifyHealthChange(change({ next: null })).recovered).toBe(false);
  });
});

describe("HealthEntityStateSchema", () => {
  it("accepts the reactive subset", () => {
    const parsed = HealthEntityStateSchema.parse({
      status: "degraded",
      healthyChecks: 1,
      totalChecks: 3,
    });
    expect(parsed.status).toBe("degraded");
  });
});

describe("mirrorHealthEntity", () => {
  function fakeHandle(): {
    handle: EntityHandle<HealthEntityState>;
    calls: Array<{ id: string; next: HealthEntityState }>;
  } {
    const calls: Array<{ id: string; next: HealthEntityState }> = [];
    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async set(id: string, next: HealthEntityState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<HealthEntityState>;
    return { handle, calls };
  }

  it("mirrors the reactive subset keyed by systemId", async () => {
    const { handle, calls } = fakeHandle();
    await mirrorHealthEntity({
      handle,
      systemId: "sys-9",
      status: "unhealthy",
      healthyChecks: 0,
      totalChecks: 4,
    });
    expect(calls).toEqual([
      {
        id: "sys-9",
        next: { status: "unhealthy", healthyChecks: 0, totalChecks: 4 },
      },
    ]);
  });

  it("is a no-op when no handle is bound (version skew / tests)", async () => {
    await mirrorHealthEntity({
      handle: undefined,
      systemId: "sys-9",
      status: "healthy",
      healthyChecks: 1,
      totalChecks: 1,
    });
    // No throw is the assertion.
    expect(true).toBe(true);
  });

  it("routes a set() failure to onError instead of throwing", async () => {
    let captured: unknown;
    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async set() {
        throw new Error("store down");
      },
    } as unknown as EntityHandle<HealthEntityState>;
    await mirrorHealthEntity({
      handle,
      systemId: "sys-9",
      status: "healthy",
      healthyChecks: 1,
      totalChecks: 1,
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("store down");
  });
});
