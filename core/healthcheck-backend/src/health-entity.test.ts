import { describe, it, expect } from "bun:test";
import type {
  EntityChanged,
  EntityHandle,
  MutateInput,
} from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  HEALTH_ENTITY_KIND,
  HEALTH_TRIGGER_EVENTS,
  HealthEntityStateSchema,
  classifyHealthChange,
  computeHealthEntityState,
  createHealthEntityRead,
  deriveHealthTriggerEvents,
  writeHealthEntity,
  type HealthEntityState,
} from "./health-entity";
import type { HealthCheckService } from "./service";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
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


// ──────────────────────────────────────────────────────────────────────────
// COMPUTE-ON-READ: the `read` accessor derives the view from durable data.
// ──────────────────────────────────────────────────────────────────────────

type CheckStatus = HealthEntityState["status"];

/**
 * Extract the bound systemId from a real drizzle `eq(column, value)` predicate.
 * `eq` returns an opaque `SQL` object whose `queryChunks` array carries the
 * bound value as a `Param`-like chunk (`{ value: "<systemId>" }`). Walking it
 * lets the fake db answer the existence gate per-system while still exercising
 * the REAL `systemHasRuns` query builder.
 */
function systemIdFromPredicate(predicate: unknown): string | undefined {
  const chunks = (predicate as { queryChunks?: unknown[] } | undefined)
    ?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value;
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * A fake db whose run-existence gate answers per systemId. Reproduces the
 * `systemHasRuns` chain `select().from().where(eq(...)).limit(1)`, resolving to
 * a row iff `present[systemId]`. The systemId is read off the real drizzle
 * predicate, so the test drives the production query shape verbatim.
 */
function runGateDb(
  present: Record<string, boolean>,
): SafeDatabase<typeof schema> {
  return {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => ({
          limit: async () => {
            const sid = systemIdFromPredicate(predicate);
            return sid && present[sid] ? [{ id: "run-1" }] : [];
          },
        }),
      }),
    }),
  } as unknown as SafeDatabase<typeof schema>;
}

/** Fake service whose `getSystemHealthStatus` returns canned per-system state. */
function fakeService(
  statusBySystem: Record<
    string,
    { status: CheckStatus; checkStatuses: Array<{ status: CheckStatus }> }
  >,
): HealthCheckService {
  return {
    getSystemHealthStatus: async (systemId: string) => {
      const found = statusBySystem[systemId];
      return {
        status: found?.status ?? ("healthy" as CheckStatus),
        evaluatedAt: new Date(),
        checkStatuses: (found?.checkStatuses ?? []).map((c, i) => ({
          configurationId: `cfg-${i}`,
          configurationName: `Check ${i}`,
          status: c.status,
          runsConsidered: 1,
        })),
      };
    },
  } as unknown as HealthCheckService;
}

describe("computeHealthEntityState (compute-on-read from durable data)", () => {
  it("omits a system with no persisted runs (existence gate)", async () => {
    const db = runGateDb({}); // no runs for any system
    const service = fakeService({
      "sys-1": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
    });
    const state = await computeHealthEntityState({
      db,
      service,
      systemId: "sys-1",
    });
    // No runs yet ⇒ no entity (mirrors the old keyed-store first-mirror create).
    expect(state).toBeUndefined();
  });

  it("derives { status, healthyChecks, totalChecks } once runs exist", async () => {
    const db = runGateDb({ "sys-1": true });
    const service = fakeService({
      "sys-1": {
        status: "degraded",
        checkStatuses: [
          { status: "healthy" },
          { status: "degraded" },
          { status: "healthy" },
        ],
      },
    });
    const state = await computeHealthEntityState({
      db,
      service,
      systemId: "sys-1",
    });
    // status = worst-wins aggregate; healthyChecks = count of "healthy";
    // totalChecks = number of enabled checks.
    expect(state).toEqual({
      status: "degraded",
      healthyChecks: 2,
      totalChecks: 3,
    });
  });
});

describe("createHealthEntityRead (batched, omits run-less systems)", () => {
  it("returns a map keyed by systemId, omitting systems with no runs", async () => {
    const db = runGateDb({ "sys-a": true, "sys-c": true });
    const service = fakeService({
      "sys-a": { status: "healthy", checkStatuses: [{ status: "healthy" }] },
      "sys-b": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
      "sys-c": {
        status: "unhealthy",
        checkStatuses: [{ status: "healthy" }, { status: "unhealthy" }],
      },
    });
    const read = createHealthEntityRead({ db, service });
    const out = await read(["sys-a", "sys-b", "sys-c"]);
    expect(out).toEqual({
      "sys-a": { status: "healthy", healthyChecks: 1, totalChecks: 1 },
      "sys-c": { status: "unhealthy", healthyChecks: 1, totalChecks: 2 },
    });
    // sys-b has status data but no runs ⇒ omitted from the batched read.
    expect(out["sys-b"]).toBeUndefined();
  });

  it("returns {} for an empty id list without touching the backing", async () => {
    const read = createHealthEntityRead({
      db: runGateDb({}),
      service: fakeService({}),
    });
    expect(await read([])).toEqual({});
  });
});

describe("writeHealthEntity (durable write driven through handle.mutate)", () => {
  /**
   * Fake handle reproducing the Model B pipeline's observable timing: snapshot
   * `prev` via `read`, run `apply` (the REAL durable write), diff, and emit on
   * a real change. Records the (prev, next) pair so the test can assert the
   * framework snapshotted prev BEFORE the durable write committed.
   */
  function fakeHandle(args: {
    read: () => Promise<HealthEntityState | undefined>;
    onEmit?: (change: {
      prev: HealthEntityState | undefined;
      next: HealthEntityState;
    }) => void;
    failAfterApply?: boolean;
  }): EntityHandle<HealthEntityState> {
    const { read, onEmit, failAfterApply } = args;
    return {
      kind: HEALTH_ENTITY_KIND,
      async mutate(input: MutateInput<HealthEntityState>) {
        const prev = await read(); // snapshot BEFORE apply
        const next = await input.apply(); // the REAL durable write
        if (failAfterApply) throw new Error("emit failed");
        // Only emit on a real change (status diff suffices for the test).
        if (!prev || prev.status !== next.status) onEmit?.({ prev, next });
        return next;
      },
    } as unknown as EntityHandle<HealthEntityState>;
  }

  it("snapshots prev BEFORE apply runs the durable write (one correct change)", async () => {
    // `read` reflects state BEFORE apply; apply flips it. The framework must
    // capture the pre-write prev, so the change is prev=healthy → next=unhealthy.
    let persisted: HealthEntityState = {
      status: "healthy",
      healthyChecks: 2,
      totalChecks: 2,
    };
    const emitted: Array<{
      prev: HealthEntityState | undefined;
      next: HealthEntityState;
    }> = [];
    const handle = fakeHandle({
      read: async () => persisted,
      onEmit: (c) => emitted.push(c),
    });

    const next = await writeHealthEntity({
      handle,
      systemId: "sys-1",
      apply: async () => {
        persisted = { status: "unhealthy", healthyChecks: 0, totalChecks: 2 };
        return persisted;
      },
    });

    expect(next).toEqual({
      status: "unhealthy",
      healthyChecks: 0,
      totalChecks: 2,
    });
    // Exactly one change, with the pre-write prev and post-write next.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].prev?.status).toBe("healthy");
    expect(emitted[0].next.status).toBe("unhealthy");
  });

  it("runs the durable write even when no handle is bound", async () => {
    let ran = false;
    const next = await writeHealthEntity({
      handle: undefined,
      systemId: "sys-1",
      apply: async () => {
        ran = true;
        return { status: "healthy", healthyChecks: 1, totalChecks: 1 };
      },
    });
    expect(ran).toBe(true);
    expect(next.status).toBe("healthy");
  });

  it("routes a post-commit framework failure to onError (fail-soft)", async () => {
    let captured: unknown;
    const handle = fakeHandle({
      read: async () => ({
        status: "healthy",
        healthyChecks: 1,
        totalChecks: 1,
      }),
      failAfterApply: true,
    });
    // apply commits, THEN the handle throws (emit failure). Must not rethrow.
    const result = await writeHealthEntity({
      handle,
      systemId: "sys-1",
      apply: async () => ({
        status: "unhealthy",
        healthyChecks: 0,
        totalChecks: 1,
      }),
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("emit failed");
    // The committed state is still returned (fail-soft, not lost).
    expect(result.status).toBe("unhealthy");
  });

  it("rethrows when the durable write itself fails (executor fallback runs)", async () => {
    const handle = fakeHandle({
      read: async () => ({
        status: "healthy",
        healthyChecks: 1,
        totalChecks: 1,
      }),
    });
    let onErrorCalled = false;
    await expect(
      writeHealthEntity({
        handle,
        systemId: "sys-1",
        apply: async () => {
          throw new Error("insert failed");
        },
        onError: () => {
          onErrorCalled = true;
        },
      }),
    ).rejects.toThrow("insert failed");
    // A durable-write failure must propagate, NOT be swallowed by onError.
    expect(onErrorCalled).toBe(false);
  });
});
