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
  createHealthEntitySerializer,
  deriveHealthTriggerEvents,
  healthChangeToPayload,
  writeHealthEntity,
  type HealthEntityState,
} from "./health-entity";
import type { HealthCheckService } from "./service";
import {
  encodeHealthEntityId,
  parseHealthEntityId,
} from "./health-entity-id";
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

describe("healthChangeToPayload — payloadSchema parity", () => {
  it("a degradation payload validates against the degraded trigger's payloadSchema", () => {
    const payload = healthChangeToPayload(change());
    const parsed = systemDegradedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.previousStatus).toBe("healthy");
    expect(parsed.newStatus).toBe("unhealthy");
    expect(parsed.healthyChecks).toBe(0);
    expect(parsed.totalChecks).toBe(2);
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("a recovery payload validates against the healthy trigger's payloadSchema", () => {
    const payload = healthChangeToPayload(
      change({
        prev: { status: "unhealthy", healthyChecks: 0, totalChecks: 2 },
        next: { status: "healthy", healthyChecks: 2, totalChecks: 2 },
      }),
    );
    const parsed = systemHealthyTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.previousStatus).toBe("unhealthy");
    expect(parsed.healthyChecks).toBe(2);
    expect(parsed.totalChecks).toBe(2);
  });

  it("any transition payload validates against the health_changed trigger's payloadSchema", () => {
    const payload = healthChangeToPayload(change());
    const parsed = systemHealthChangedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.previousStatus).toBe("healthy");
    expect(parsed.newStatus).toBe("unhealthy");
  });
});

describe("classifyHealthChange (cross-plugin consumer predicate)", () => {
  it("flags degraded on healthy → unhealthy (the old systemDegraded condition)", () => {
    const c = classifyHealthChange(change());
    expect(c).toEqual({
      systemId: "sys-1",
      environmentId: null,
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
 * Fake service whose `getSystemHealthStatus` returns canned per-system state.
 * A system absent from the map gets the SAME default-`healthy` baseline the
 * real `getSystemHealthStatus` returns for an empty run window — and an empty
 * `checkStatuses` for a system with no enabled associations (the existence
 * gate), exactly like production.
 */
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
  it("omits a system with NO enabled check associations (existence gate)", async () => {
    // No enabled associations ⇒ `getSystemHealthStatus` returns checkStatuses:
    // [] ⇒ no `health` entity for this system.
    const service = fakeService({
      "sys-1": { status: "healthy", checkStatuses: [] },
    });
    const state = await computeHealthEntityState({ service, systemId: "sys-1" });
    expect(state).toBeUndefined();
  });

  it("resolves the default-`healthy` baseline for a system with an enabled check but no runs yet", async () => {
    // A run-less system with an enabled check evaluates to the default-healthy
    // baseline (the executor's pre-run state), NOT undefined — so a first-ever
    // unhealthy run is a real healthy → degraded diff (Defect 1 fix).
    const service = fakeService({
      "sys-1": {
        status: "healthy",
        checkStatuses: [{ status: "healthy" }, { status: "healthy" }],
      },
    });
    const state = await computeHealthEntityState({ service, systemId: "sys-1" });
    expect(state).toEqual({
      status: "healthy",
      healthyChecks: 2,
      totalChecks: 2,
    });
  });

  it("derives { status, healthyChecks, totalChecks } from the worst-wins aggregate", async () => {
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
    const state = await computeHealthEntityState({ service, systemId: "sys-1" });
    // status = worst-wins aggregate; healthyChecks = count of "healthy";
    // totalChecks = number of enabled checks.
    expect(state).toEqual({
      status: "degraded",
      healthyChecks: 2,
      totalChecks: 3,
    });
  });
});

describe("createHealthEntityRead (batched, omits checkless systems)", () => {
  it("returns a map keyed by systemId, omitting systems with no enabled checks", async () => {
    const service = fakeService({
      "sys-a": { status: "healthy", checkStatuses: [{ status: "healthy" }] },
      // sys-b has NO enabled associations ⇒ omitted from the read.
      "sys-b": { status: "healthy", checkStatuses: [] },
      "sys-c": {
        status: "unhealthy",
        checkStatuses: [{ status: "healthy" }, { status: "unhealthy" }],
      },
    });
    const read = createHealthEntityRead({ service });
    const out = await read(["sys-a", "sys-b", "sys-c"]);
    expect(out).toEqual({
      "sys-a": { status: "healthy", healthyChecks: 1, totalChecks: 1 },
      "sys-c": { status: "unhealthy", healthyChecks: 1, totalChecks: 2 },
    });
    expect(out["sys-b"]).toBeUndefined();
  });

  it("returns {} for an empty id list without touching the backing", async () => {
    const read = createHealthEntityRead({ service: fakeService({}) });
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
      entityId: "sys-1",
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
      entityId: "sys-1",
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
      entityId: "sys-1",
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
        entityId: "sys-1",
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

// ──────────────────────────────────────────────────────────────────────────
// DEFECT 1 (first-run degradation): a system whose very first run comes up
// unhealthy must produce a real healthy → degraded diff so `system_degraded` /
// `health_changed` fire and the `degraded` `onEntityChanged` opens SLO /
// dependency downtime — NOT a suppressed create (prev === null).
// ──────────────────────────────────────────────────────────────────────────

describe("first-run-unhealthy degradation (Defect 1 regression)", () => {
  /**
   * A handle whose `read` snapshots `prev` from `computeHealthEntityState`
   * (the SAME compute-on-read accessor production uses) against a service that
   * reflects the durable state. Before `apply`, the system has an enabled
   * check but no runs ⇒ default-`healthy` baseline; `apply` records the first
   * (unhealthy) run, so the post-write read sees unhealthy. We assert the
   * framework-style change (prev → next) drives the directional + umbrella
   * trigger events and the `degraded` classification.
   */
  it("fires system_degraded + umbrella and a `degraded` onEntityChanged on the first-ever unhealthy run", async () => {
    // Durable state the fake service reads. Starts run-less (default healthy),
    // flips to unhealthy when the first run is recorded by `apply`.
    let firstRunRecorded = false;
    const service = {
      getSystemHealthStatus: async () => ({
        status: firstRunRecorded
          ? ("unhealthy" as CheckStatus)
          : ("healthy" as CheckStatus),
        evaluatedAt: new Date(),
        // One ENABLED check association exists from the start (run-less but
        // configured), so the entity resolves to the healthy baseline.
        checkStatuses: [
          {
            configurationId: "cfg-0",
            configurationName: "Check 0",
            status: firstRunRecorded
              ? ("unhealthy" as CheckStatus)
              : ("healthy" as CheckStatus),
            runsConsidered: firstRunRecorded ? 1 : 0,
          },
        ],
      }),
    } as unknown as HealthCheckService;

    const emitted: Array<{
      prev: HealthEntityState | undefined;
      next: HealthEntityState;
    }> = [];

    // Model B handle: snapshot prev via the REAL compute-on-read accessor
    // BEFORE apply, run apply, diff, emit on a real change.
    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async mutate(input: MutateInput<HealthEntityState>) {
        const prev = await computeHealthEntityState({
          service,
          systemId: "sys-1",
        });
        const next = await input.apply();
        if (!prev || prev.status !== next.status) onEmitChange(prev, next);
        return next;
      },
    } as unknown as EntityHandle<HealthEntityState>;

    function onEmitChange(
      prev: HealthEntityState | undefined,
      next: HealthEntityState,
    ) {
      emitted.push({ prev, next });
    }

    const next = await writeHealthEntity({
      handle,
      entityId: "sys-1",
      apply: async () => {
        // The durable first run lands here (unhealthy).
        firstRunRecorded = true;
        const computed = await computeHealthEntityState({
          service,
          systemId: "sys-1",
        });
        if (!computed) throw new Error("expected a computed view");
        return computed;
      },
    });

    // Exactly one emit, a real healthy → unhealthy transition (NOT a create).
    expect(emitted).toHaveLength(1);
    expect(emitted[0].prev).toEqual({
      status: "healthy",
      healthyChecks: 1,
      totalChecks: 1,
    });
    expect(emitted[0].next.status).toBe("unhealthy");
    expect(next.status).toBe("unhealthy");

    // The deriver fires the directional + umbrella trigger events.
    const events = deriveHealthTriggerEvents({
      kind: HEALTH_ENTITY_KIND,
      id: "sys-1",
      prev: emitted[0].prev ?? null,
      next: emitted[0].next,
      delta: {},
      changedFields: ["status"],
      actor: SYSTEM_ACTOR,
      occurredAt: new Date().toISOString(),
    });
    expect(events).toEqual([
      HEALTH_TRIGGER_EVENTS.degraded,
      HEALTH_TRIGGER_EVENTS.healthChanged,
    ]);

    // The cross-plugin consumer predicate reports `degraded` (opens SLO /
    // dependency downtime).
    const classified = classifyHealthChange({
      id: "sys-1",
      prev: emitted[0].prev ?? null,
      next: emitted[0].next,
    });
    expect(classified.degraded).toBe(true);
    expect(classified.recovered).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DEFECT 2 (concurrent N-pod evaluation): two concurrent `writeHealthEntity`
// for ONE system must serialize through prev-snapshot → emit, producing
// exactly ONE transition + ONE emit (not two).
// ──────────────────────────────────────────────────────────────────────────

describe("per-system serialization (Defect 2 regression)", () => {
  /**
   * A faithful in-memory stand-in for `withXactLock`'s mutual exclusion: a
   * per-key promise chain. Two callers with the same key run strictly one
   * after another; the second cannot enter until the first resolves — exactly
   * the guarantee `pg_advisory_xact_lock` provides across pods.
   */
  function makeKeyedSerializer() {
    const chains = new Map<string, Promise<unknown>>();
    return (key: string) =>
      <T>(fn: () => Promise<T>): Promise<T> => {
        const prior = chains.get(key) ?? Promise.resolve();
        const next = prior.then(fn, fn);
        chains.set(
          key,
          next.then(
            () => undefined,
            () => undefined,
          ),
        );
        return next;
      };
  }

  it("two concurrent evals of one system emit exactly ONE transition", async () => {
    // Shared durable state both evaluations write to. The first failing run
    // flips it to unhealthy; the second sees it already unhealthy ⇒ no-op.
    let unhealthy = false;
    const compute = (): HealthEntityState => ({
      status: unhealthy ? "unhealthy" : "healthy",
      healthyChecks: unhealthy ? 0 : 1,
      totalChecks: 1,
    });

    const emitted: Array<{
      prev: HealthEntityState | undefined;
      next: HealthEntityState;
    }> = [];

    // Model B handle: snapshot prev (current durable view) BEFORE apply, run
    // apply, diff, emit on a real change. With NO lock, two concurrent calls
    // both snapshot prev=healthy and both emit; the lock prevents that.
    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async mutate(input: MutateInput<HealthEntityState>) {
        const prev = compute(); // snapshot BEFORE apply
        // Yield so the second concurrent caller could interleave here if it
        // were not serialized — the lock must prevent that.
        await Promise.resolve();
        const next = await input.apply();
        if (prev.status !== next.status) emitted.push({ prev, next });
        return next;
      },
    } as unknown as EntityHandle<HealthEntityState>;

    const keyed = makeKeyedSerializer();
    const serialize = keyed(`health:sys-1`);

    const evalOnce = () =>
      writeHealthEntity({
        handle,
        entityId: "sys-1",
        serialize,
        apply: async () => {
          // The durable "insert failing run" — first writer flips the state.
          unhealthy = true;
          return compute();
        },
      });

    // Fire both concurrently for the SAME system.
    await Promise.all([evalOnce(), evalOnce()]);

    // Exactly one logical transition emitted (healthy → unhealthy), not two.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].prev?.status).toBe("healthy");
    expect(emitted[0].next.status).toBe("unhealthy");
  });

  it("createHealthEntitySerializer routes work through the advisory lock keyed `health:<systemId>`", async () => {
    // The serializer now delegates to the shared AdvisoryLockService's
    // `withXactLock` (lock held on the dedicated lock pool, work on the admin
    // pool). Assert the per-system namespaced key flows through and `fn` runs.
    const keys: string[] = [];
    const advisoryLock = {
      tryAcquire: async () => ({ release: async () => {} }),
      withXactLock<T>({
        key,
        fn,
      }: {
        key: string;
        fn: () => Promise<T>;
      }): Promise<T> {
        keys.push(key);
        return fn();
      },
    } satisfies Parameters<
      typeof createHealthEntitySerializer
    >[0]["advisoryLock"];

    const serializer = createHealthEntitySerializer({ advisoryLock });
    const result = await serializer("sys-42")(async () => "ok");

    expect(result).toBe("ok");
    // The advisory lock was acquired with the per-system namespaced key.
    expect(keys).toContain("health:sys-42");
  });

  it("serializes per ENV-QUALIFIED id so distinct envs / the rollup use distinct lock keys", async () => {
    const keys: string[] = [];
    const advisoryLock = {
      tryAcquire: async () => ({ release: async () => {} }),
      withXactLock<T>({
        key,
        fn,
      }: {
        key: string;
        fn: () => Promise<T>;
      }): Promise<T> {
        keys.push(key);
        return fn();
      },
    } satisfies Parameters<
      typeof createHealthEntitySerializer
    >[0]["advisoryLock"];

    const make = createHealthEntitySerializer({ advisoryLock });
    await make(encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" }))(
      async () => "ok",
    );
    await make(encodeHealthEntityId({ systemId: "sys-1", environmentId: "staging" }))(
      async () => "ok",
    );
    await make(encodeHealthEntityId({ systemId: "sys-1" }))(async () => "ok");

    // Per-env keys are env-qualified; the rollup uses the bare systemId. All
    // three are DISTINCT, so they never block each other.
    expect(keys).toEqual([
      "health:sys-1::prod",
      "health:sys-1::staging",
      "health:sys-1",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PHASE 3b: the `health` entity is env-keyed — `<systemId>` (rollup) and
// `<systemId>::<environmentId>` (per-env) views share one kind, distinguished
// only by id-shape. The rollup MUST preserve the pre-3b system-level contract.
// ──────────────────────────────────────────────────────────────────────────

describe("health-entity-id encode/parse round-trip", () => {
  it("encodes the bare systemId for the rollup (no environment)", () => {
    expect(encodeHealthEntityId({ systemId: "sys-1" })).toBe("sys-1");
    expect(encodeHealthEntityId({ systemId: "sys-1", environmentId: null })).toBe(
      "sys-1",
    );
  });

  it("encodes `<systemId>::<environmentId>` for a per-env id", () => {
    expect(
      encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" }),
    ).toBe("sys-1::prod");
  });

  it("parses a bare id as the rollup (environmentId null)", () => {
    expect(parseHealthEntityId("sys-1")).toEqual({
      systemId: "sys-1",
      environmentId: null,
    });
  });

  it("parses a per-env id into (systemId, environmentId)", () => {
    expect(parseHealthEntityId("sys-1::prod")).toEqual({
      systemId: "sys-1",
      environmentId: "prod",
    });
  });
});

/** Sentinel key for the env-less slice (`environmentId === null`) in the fake.
 * Kept DISTINCT from the rollup key (`"<systemId>"`, selected by `undefined`)
 * so the fake faithfully models production's `IS NULL` filter — collapsing
 * them is what masked the rollup BLOCKER. */
const ENVLESS_KEY = "::__envless__";

/**
 * Env-aware fake service: `getSystemHealthStatus(systemId, environmentId)`
 * returns canned per-(system, env) state, distinguishing all THREE arg modes
 * exactly as production's SQL does:
 * - `environmentId === undefined` ⇒ ROLLUP (all runs) — key `"<systemId>"`.
 * - `environmentId === null`      ⇒ ENV-LESS slice (`env_id IS NULL`) — key
 *   `"<systemId>::__envless__"` (DISTINCT from the rollup key).
 * - a string                      ⇒ per-env slice — key `"<systemId>::<env>"`.
 */
function fakeEnvService(
  byEntityId: Record<
    string,
    { status: CheckStatus; checkStatuses: Array<{ status: CheckStatus }> }
  >,
): HealthCheckService {
  return {
    getSystemHealthStatus: async (
      systemId: string,
      environmentId?: string | null,
    ) => {
      const key =
        environmentId === undefined
          ? systemId
          : environmentId === null
            ? `${systemId}${ENVLESS_KEY}`
            : `${systemId}::${environmentId}`;
      const found = byEntityId[key];
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

describe("createHealthEntityRead — env-keyed (rollup vs per-env)", () => {
  it("resolves the per-env view for a `<systemId>::<env>` id and the rollup for a bare id", async () => {
    const service = fakeEnvService({
      // Rollup: worst across envs (unhealthy because prod is unhealthy).
      "sys-1": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
      "sys-1::prod": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
      "sys-1::staging": {
        status: "healthy",
        checkStatuses: [{ status: "healthy" }],
      },
    });
    const read = createHealthEntityRead({ service });
    const out = await read(["sys-1", "sys-1::prod", "sys-1::staging"]);

    // Keyed by the ORIGINAL (env-qualified) id, each resolving the right view.
    expect(out["sys-1"]?.status).toBe("unhealthy"); // rollup
    expect(out["sys-1::prod"]?.status).toBe("unhealthy"); // per-env
    expect(out["sys-1::staging"]?.status).toBe("healthy"); // per-env
  });

  it("rollup of a system WITH environments reads ALL runs (worst status), NOT the env-less slice (BLOCKER regression)", async () => {
    // A system whose runs ALL carry a non-null env_id: there is NO env-less
    // slice entry. The bare-`<systemId>` ROLLUP must read ALL runs (worst
    // status across envs), NOT `env_id IS NULL` (which would find zero rows and
    // report default healthy). The fake omits the ENV-LESS key entirely, so a
    // bug that resolved the rollup via `null` would return default healthy here.
    const service = fakeEnvService({
      // Rollup (all-runs / `undefined`): worst across envs = unhealthy.
      "sys-1": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
      "sys-1::prod": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }],
      },
      "sys-1::staging": {
        status: "healthy",
        checkStatuses: [{ status: "healthy" }],
      },
      // NOTE: deliberately NO "sys-1::__envless__" entry — every run has an env.
    });
    const read = createHealthEntityRead({ service });
    const out = await read(["sys-1"]);
    // Worst status across environments — NOT the (empty) env-less slice's
    // default healthy.
    expect(out["sys-1"]?.status).toBe("unhealthy");
  });

  it("rollup preserves the pre-3b contract: a bare-systemId read equals today's status when no envs exist", async () => {
    // A system with no environments has only the bare-systemId (rollup =
    // env-less) entry — exactly the pre-3b shape.
    const service = fakeEnvService({
      "sys-1": {
        status: "degraded",
        checkStatuses: [{ status: "healthy" }, { status: "degraded" }],
      },
    });
    const read = createHealthEntityRead({ service });
    const out = await read(["sys-1"]);
    expect(out["sys-1"]).toEqual({
      status: "degraded",
      healthyChecks: 1,
      totalChecks: 2,
    });
  });

  it("omits a per-env id whose system has no enabled checks (existence gate holds per id)", async () => {
    const service = fakeEnvService({
      "sys-1::prod": { status: "healthy", checkStatuses: [] },
    });
    const read = createHealthEntityRead({ service });
    const out = await read(["sys-1::prod"]);
    expect(out["sys-1::prod"]).toBeUndefined();
  });
});

describe("computeHealthEntityState — environment-aware", () => {
  it("computes the env-scoped view for a concrete environment", async () => {
    const service = fakeEnvService({
      "sys-1::prod": {
        status: "unhealthy",
        checkStatuses: [{ status: "unhealthy" }, { status: "healthy" }],
      },
    });
    const state = await computeHealthEntityState({
      service,
      systemId: "sys-1",
      environmentId: "prod",
    });
    expect(state).toEqual({
      status: "unhealthy",
      healthyChecks: 1,
      totalChecks: 2,
    });
  });

  it("computes the rollup view when environmentId is omitted", async () => {
    const service = fakeEnvService({
      "sys-1": {
        status: "degraded",
        checkStatuses: [{ status: "degraded" }],
      },
    });
    const state = await computeHealthEntityState({ service, systemId: "sys-1" });
    expect(state?.status).toBe("degraded");
  });
});

describe("healthChangeToPayload — env-qualified id", () => {
  it("sets payload.environmentId for a PER-ENV change and validates against the schema", () => {
    const payload = healthChangeToPayload(
      change({ id: encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" }) }),
    );
    const parsed = systemDegradedTrigger.payloadSchema.parse(payload);
    // systemId is the bare systemId portion; environmentId is the env.
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.environmentId).toBe("prod");
  });

  it("OMITS environmentId for the system ROLLUP change (back-compat: bare systemId)", () => {
    const payload = healthChangeToPayload(change({ id: "sys-1" }));
    const parsed = systemHealthChangedTrigger.payloadSchema.parse(payload);
    expect(parsed.systemId).toBe("sys-1");
    // Absent for the rollup — existing system-level automations are unaffected.
    expect(parsed.environmentId).toBeUndefined();
  });
});

describe("classifyHealthChange — env-qualified id", () => {
  it("reports the systemId portion + environmentId for a per-env change", () => {
    const c = classifyHealthChange(
      change({ id: encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" }) }),
    );
    expect(c.systemId).toBe("sys-1");
    expect(c.environmentId).toBe("prod");
    expect(c.degraded).toBe(true);
  });

  it("reports environmentId null for the rollup change", () => {
    const c = classifyHealthChange(change({ id: "sys-1" }));
    expect(c.systemId).toBe("sys-1");
    expect(c.environmentId).toBeNull();
  });
});

describe("per-env + rollup serialization under concurrent writes", () => {
  /** Same keyed-serializer stand-in as the Defect-2 test, reused here. */
  function makeKeyedSerializer() {
    const chains = new Map<string, Promise<unknown>>();
    return (key: string) =>
      <T>(fn: () => Promise<T>): Promise<T> => {
        const prior = chains.get(key) ?? Promise.resolve();
        const next = prior.then(fn, fn);
        chains.set(
          key,
          next.then(
            () => undefined,
            () => undefined,
          ),
        );
        return next;
      };
  }

  it("two concurrent evals of the SAME (system, env) emit exactly one transition", async () => {
    let unhealthy = false;
    const compute = (): HealthEntityState => ({
      status: unhealthy ? "unhealthy" : "healthy",
      healthyChecks: unhealthy ? 0 : 1,
      totalChecks: 1,
    });
    const emitted: Array<{
      prev: HealthEntityState | undefined;
      next: HealthEntityState;
    }> = [];
    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async mutate(input: MutateInput<HealthEntityState>) {
        const prev = compute();
        await Promise.resolve();
        const next = await input.apply();
        if (prev.status !== next.status) emitted.push({ prev, next });
        return next;
      },
    } as unknown as EntityHandle<HealthEntityState>;

    const keyed = makeKeyedSerializer();
    const envId = encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" });
    const serialize = keyed(`health:${envId}`);
    const evalOnce = () =>
      writeHealthEntity({
        handle,
        entityId: envId,
        serialize,
        apply: async () => {
          unhealthy = true;
          return compute();
        },
      });

    await Promise.all([evalOnce(), evalOnce()]);
    expect(emitted).toHaveLength(1);
  });

  it("a per-env write and the rollup write run in PARALLEL (distinct keys, no mutual block)", async () => {
    const keyed = makeKeyedSerializer();
    const order: string[] = [];
    const envId = encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" });
    const rollupId = encodeHealthEntityId({ systemId: "sys-1" });

    const handle = {
      kind: HEALTH_ENTITY_KIND,
      async mutate(input: MutateInput<HealthEntityState>) {
        return input.apply();
      },
    } as unknown as EntityHandle<HealthEntityState>;

    // The env write holds its critical section across a microtask; if the
    // rollup were on the SAME key it would be forced to wait. Distinct keys
    // let them interleave.
    const envWrite = writeHealthEntity({
      handle,
      entityId: envId,
      serialize: keyed(`health:${envId}`),
      apply: async () => {
        order.push("env-start");
        await Promise.resolve();
        order.push("env-end");
        return { status: "healthy", healthyChecks: 1, totalChecks: 1 };
      },
    });
    const rollupWrite = writeHealthEntity({
      handle,
      entityId: rollupId,
      serialize: keyed(`health:${rollupId}`),
      apply: async () => {
        order.push("rollup-start");
        return { status: "healthy", healthyChecks: 1, totalChecks: 1 };
      },
    });

    await Promise.all([envWrite, rollupWrite]);

    // Interleaved: rollup-start ran before env-end (they did not serialize).
    expect(order.indexOf("rollup-start")).toBeLessThan(order.indexOf("env-end"));
  });
});
