/**
 * The reactive `health` entity (reactive automation engine §10.3).
 *
 * Model B PLUGIN-BACKED + COMPUTED entity. There is NO framework `entity_state`
 * row for a system's aggregated health and NO domain table of its own — the
 * reactive subset `{ status, healthyChecks, totalChecks }` is COMPUTED on demand
 * by the `read` accessor from the SAME durable health data the rest of the
 * plugin reads (`health_check_runs` via `service.getSystemHealthStatus`). Every
 * evaluation-site write goes through `handle.mutate`, whose `apply` performs the
 * REAL durable write (insert run + increment aggregate) and returns the
 * freshly-computed view. The framework snapshots `prev` via `read` BEFORE
 * `apply` runs (i.e. before the run is persisted), diffs prev → next, appends
 * the transition log, and emits `ENTITY_CHANGED`.
 *
 * This module is the single source of truth for:
 *  - the `health` entity zod state schema + kind id,
 *  - the PLUGIN-BACKED + COMPUTED `read` accessor
 *    ({@link createHealthEntityRead}),
 *  - the change → trigger-event deriver (so the existing
 *    `healthcheck.system.degraded` / `.healthy` / `.health_changed`
 *    automations keep firing), and
 *  - the `writeHealthEntity` helper called at every evaluation-write site.
 */
import { z } from "zod";
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";
import type { AdvisoryLockService } from "@checkstack/backend-api";
import type {
  EntityChangeDeriver,
  EntityChangePayloadMapper,
  EntityHandle,
  EntityRead,
} from "@checkstack/automation-backend";
import type { HealthCheckService } from "./service";
import { parseHealthEntityId } from "./health-entity-id";

/** Entity kind id for the aggregated health (system rollup + per-environment). */
export const HEALTH_ENTITY_KIND = "health";

/**
 * Reactive state subset surfaced as the entity view. The full aggregate
 * (per-check breakdown, timestamps, etc.) stays in the domain tables; only
 * the fields automations reason about live here. Computed on read from the
 * same durable data `getSystemHealthStatus` reads — never materialized.
 */
export const HealthEntityStateSchema = z.object({
  status: HealthCheckStatusSchema,
  healthyChecks: z.number().int().nonnegative(),
  totalChecks: z.number().int().nonnegative(),
});

export type HealthEntityState = z.infer<typeof HealthEntityStateSchema>;

/**
 * Qualified trigger event ids the health entity drives. These are the
 * TRIGGER qualifiedIds (`${pluginId}.${trigger.id}`) that automations store
 * in `trigger.event` and that Stage-1 routing matches on via
 * `findEnabledByTriggerEvent` — NOT the underlying hook ids. The healthcheck
 * triggers use underscore ids (`system_degraded`, …), so the deriver must
 * emit `healthcheck.system_degraded`, not the dotted hook id
 * `healthcheck.system.degraded`. (Verified against `automations.ts` trigger
 * ids + `trigger-subscriber.ts` which fires on `t.event === qualifiedId`.)
 */
export const HEALTH_TRIGGER_EVENTS = {
  degraded: "healthcheck.system_degraded",
  healthy: "healthcheck.system_healthy",
  healthChanged: "healthcheck.system_health_changed",
} as const;

/**
 * Read `status` off a serialized entity-state record (the change payload's
 * `prev` / `next` are plain JSON records, not the typed state).
 */
function readStatus(state: Record<string, unknown> | null): string | null {
  if (state === null) return null;
  const status = state["status"];
  return typeof status === "string" ? status : null;
}

/**
 * Map a `health` entity change to the qualified trigger event id(s) the
 * existing automations match on. Reproduces the directional + umbrella emit
 * conditions that lived inline in `queue-executor.ts`:
 *  - recovery (→ healthy):  next === "healthy" && prev !== "healthy"
 *  - degradation:           prev === "healthy" && next !== "healthy"
 *  - umbrella (any change): prev !== next
 *
 * A create (`prev === null`) or tombstone (`next === null`) fires nothing —
 * there is no prior aggregate transition to react to, matching the old
 * behavior where the directional/umbrella hooks only emitted on a real
 * status transition of an already-tracked system.
 */
export const deriveHealthTriggerEvents: EntityChangeDeriver = (changed) => {
  const prev = readStatus(changed.prev);
  const next = readStatus(changed.next);
  if (prev === null || next === null) return [];
  if (prev === next) return [];

  const events: string[] = [];
  if (next === "healthy") {
    events.push(HEALTH_TRIGGER_EVENTS.healthy);
  } else if (prev === "healthy") {
    events.push(HEALTH_TRIGGER_EVENTS.degraded);
  }
  // Umbrella fires on every transition, alongside the directional event.
  events.push(HEALTH_TRIGGER_EVENTS.healthChanged);
  return events;
};

function readNumber(
  state: Record<string, unknown> | null,
  field: string,
): number | undefined {
  if (state === null) return undefined;
  const value = state[field];
  return typeof value === "number" ? value : undefined;
}

/**
 * Map a `health` entity change to the domain-named `trigger.payload` the
 * healthcheck triggers declare via `payloadSchema` (`systemId`,
 * `previousStatus`, `newStatus`, `healthyChecks`, `totalChecks`, `timestamp`).
 * Restores the keys operators read (`trigger.payload.systemId`,
 * `.previousStatus`, …) that the generic change shape omits.
 *
 * The entity id is now env-qualified (Phase 3b): `payload.systemId` is ALWAYS
 * the systemId portion (so existing automations reading `trigger.payload.systemId`
 * are unaffected — the rollup carries the bare systemId), and the NEW optional
 * `payload.environmentId` is the env portion — present only for a per-environment
 * change, absent (undefined) for the system rollup. `previousStatus` is
 * `prev.status` and `newStatus` is `next.status`; `healthyChecks` / `totalChecks`
 * come from `next`; `timestamp` is the change's `occurredAt`. `systemName` is not
 * derivable from a health change (it lives in the catalog) and is OPTIONAL on the
 * schemas, so it is omitted.
 */
export const healthChangeToPayload: EntityChangePayloadMapper = (changed) => {
  const { systemId, environmentId } = parseHealthEntityId(changed.id);
  return {
    systemId,
    // Present only for a per-env change; omitted for the rollup so the field
    // is `undefined` (the optional schema accepts both).
    ...(environmentId === null ? {} : { environmentId }),
    previousStatus: readStatus(changed.prev) ?? undefined,
    newStatus: readStatus(changed.next) ?? undefined,
    healthyChecks: readNumber(changed.next, "healthyChecks") ?? 0,
    totalChecks: readNumber(changed.next, "totalChecks") ?? 0,
    timestamp: changed.occurredAt,
  };
};

/**
 * Classify a `health` entity change for cross-plugin consumers (slo,
 * dependency) that previously subscribed to the directional
 * `systemDegraded` / `systemHealthy` hooks. Returns the systemId plus
 * boolean transition flags, reproducing the exact emit conditions so a
 * consumer can reproduce its old behavior via `onEntityChanged`.
 *
 * - `degraded`: prev === "healthy" && next !== "healthy" (and next exists)
 * - `recovered`: next === "healthy" && prev !== "healthy" (and prev exists)
 *
 * Create / tombstone produce neither (no prior aggregate transition).
 */
export interface HealthChangeClassification {
  systemId: string;
  /**
   * The environment portion of the entity id (Phase 3b). `null` for the
   * system rollup change; the env id for a per-environment change. Cross-plugin
   * consumers that only care about the system (SLO / dependency) can ignore it.
   */
  environmentId: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  degraded: boolean;
  recovered: boolean;
}

export function classifyHealthChange(changed: {
  id: string;
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}): HealthChangeClassification {
  const { systemId, environmentId } = parseHealthEntityId(changed.id);
  const previousStatus = readStatus(changed.prev);
  const newStatus = readStatus(changed.next);
  const bothPresent = previousStatus !== null && newStatus !== null;
  const degraded =
    bothPresent && previousStatus === "healthy" && newStatus !== "healthy";
  const recovered =
    bothPresent && newStatus === "healthy" && previousStatus !== "healthy";
  return {
    systemId,
    environmentId,
    previousStatus,
    newStatus,
    degraded,
    recovered,
  };
}

/**
 * Compute the reactive `health` view for a single system from durable data.
 *
 * Derives `{ status, healthyChecks, totalChecks }` from the SAME default-
 * `healthy` baseline aggregate the executor reads via
 * `getSystemHealthStatus`:
 *  - `status`         = `getSystemHealthStatus(systemId).status` (the worst-
 *    wins aggregate across the system's ENABLED checks, computed from
 *    `health_check_runs` via `evaluateHealthStatus`; a check with no runs yet
 *    evaluates to `"healthy"`),
 *  - `healthyChecks`  = count of per-check statuses that are `"healthy"`,
 *  - `totalChecks`    = number of enabled checks (`checkStatuses.length`).
 *
 * EXISTENCE GATE: the entity resolves iff the system has at least one ENABLED
 * check association (`checkStatuses.length > 0`). A system with no enabled
 * checks has no `health` entity and is omitted from the batched `read` (its
 * health is undefined, not a meaningful `healthy`).
 *
 * The gate is intentionally on ASSOCIATIONS, not on persisted runs: a system
 * that has an enabled check but has never run yet resolves to the default-
 * `healthy` baseline (the exact value `getSystemHealthStatus` returns for an
 * empty run window). That makes a first-ever evaluation that comes up
 * unhealthy a real `healthy → degraded` diff — firing `system_degraded` /
 * `health_changed` and the `degraded` `onEntityChanged` for SLO/dependency
 * consumers — instead of a suppressed create (`prev === null`). The entity and
 * the executor therefore agree on the pre-run baseline.
 */
export async function computeHealthEntityState(args: {
  service: HealthCheckService;
  systemId: string;
  /**
   * Environment to compute the view for (Phase 3b). `undefined` = the SYSTEM
   * ROLLUP (worst status across all environments + env-less runs — the
   * all-runs aggregate, §7.4.2). `null` = the env-less slice. A string = that
   * environment's per-env view. The existence gate (`checkStatuses.length`) is
   * env-independent, so a per-env view and the rollup agree on totalChecks.
   */
  environmentId?: string | null;
}): Promise<HealthEntityState | undefined> {
  const { service, systemId, environmentId } = args;
  const overview = await service.getSystemHealthStatus(systemId, environmentId);
  // No enabled check associations ⇒ no health entity for this system.
  if (overview.checkStatuses.length === 0) return undefined;
  return {
    status: overview.status,
    healthyChecks: overview.checkStatuses.filter((c) => c.status === "healthy")
      .length,
    totalChecks: overview.checkStatuses.length,
  };
}

/**
 * Build the PLUGIN-BACKED + COMPUTED `read` accessor for the `health` entity.
 *
 * Env-aware id parsing (Phase 3b, §7.4.2): each incoming id is parsed via
 * {@link parseHealthEntityId}. A BARE `"<systemId>"` resolves the SYSTEM
 * ROLLUP; a `"<systemId>::<environmentId>"` resolves that environment's
 * per-env view. The result is keyed by the ORIGINAL id, so the reactive
 * engine, `getMany`, and scope enrichment all see the right view for the id
 * they asked for. Systems with no enabled check associations are omitted
 * (existence gate). No framework `entity_state` storage — compute-on-read from
 * the durable, env-keyed `health_check_runs`, so a read returns the same answer
 * on every pod (state-and-scale).
 */
export function createHealthEntityRead(deps: {
  service: HealthCheckService;
}): EntityRead<HealthEntityState> {
  const { service } = deps;
  return async (ids) => {
    if (ids.length === 0) return {};
    const out: Record<string, HealthEntityState> = {};
    await Promise.all(
      ids.map(async (id) => {
        const { systemId, environmentId } = parseHealthEntityId(id);
        const state = await computeHealthEntityState({
          service,
          systemId,
          // A bare `<systemId>` id is the ROLLUP: `parseHealthEntityId`
          // returns `environmentId: null` for it (so the payload mapper can
          // tell "rollup → omit environmentId"), but the rollup must read ALL
          // runs — `undefined` — NOT the env-less slice (`null`, which filters
          // to `env_id IS NULL`). Reserve `null` for an explicit env-less
          // read; map the rollup's null to undefined here.
          environmentId: environmentId === null ? undefined : environmentId,
        });
        if (state) out[id] = state;
      }),
    );
    return out;
  };
}

/**
 * Drive an evaluation-site health write through `handle.mutate` (§10.3).
 *
 * `apply` performs the REAL durable write (insert the run + increment the
 * hourly aggregate) and returns the freshly-computed `health` view. The
 * framework snapshots `prev` via `read` BEFORE `apply` runs — i.e. BEFORE the
 * run is persisted — so a real status change yields exactly one correct
 * `ENTITY_CHANGED` with accurate prev → next, whose deriver fires the
 * `healthcheck.system_degraded` / `_healthy` / `_health_changed` trigger
 * events. An unchanged aggregate is a no-op (the handle diffs internally).
 *
 * Concurrency:
 *  - `serialize`, when provided, wraps the ENTIRE snapshot-prev + apply + diff
 *    + emit (the `handle.mutate` call) in a per-`systemId` critical section.
 *    Without it, concurrent evaluations of one system (multiple per-config jobs
 *    across pods, or at-least-once redelivery) interleave: both snapshot
 *    `prev = healthy`, both persist a failing run, both diff `healthy →
 *    degraded`, and both emit — yielding two `ENTITY_CHANGED` + two transition
 *    rows for one logical transition (inflating `transitionCount`/flapping and
 *    re-running dependency notify). The executor wires this to a transaction-
 *    scoped advisory lock keyed `health:<systemId>` (`withXactLock`), so two
 *    concurrent evals of one system serialize through prev-snapshot to emit.
 *    The durable `apply` write is the SAME whether serialized or not — only the
 *    snapshot/diff/emit window is protected.
 *
 * Failure handling:
 *  - When no `handle` is bound (version skew / tests), `apply` still runs —
 *    the durable write is never gated on entity reactivity. (The serialization
 *    lock is part of the reactive path, so an unbound handle skips it too; the
 *    durable insert keeps its own ordering guarantees.)
 *  - If `apply` throws BEFORE the durable write commits, the error propagates
 *    so the executor's own error path (fallback insert) runs. We detect this
 *    via `durableState`: it is only set once `apply` has produced its view, so
 *    if it is still unset when `mutate` throws, the durable write did not
 *    commit.
 *  - If the FRAMEWORK reactivity throws AFTER the durable write committed
 *    (transition append / emit — the documented Model B post-commit boundary),
 *    we route it to `onError` and DO NOT rethrow: a reactivity failure must
 *    never break health-check execution (the durable tables already hold the
 *    authoritative state).
 *
 * Returns the computed view (or `undefined` if `apply` never produced one,
 * which only happens when it threw and `handle` was absent — in which case the
 * throw already propagated).
 */
export async function writeHealthEntity(args: {
  handle: EntityHandle<HealthEntityState> | undefined;
  /**
   * The `health` entity id to mutate (Phase 3b): the env-qualified
   * `"<systemId>::<environmentId>"` for a per-env write, or the bare
   * `"<systemId>"` for the env-less / system-rollup write. This is the id the
   * framework diffs/emits, so it drives both the per-env and rollup
   * `ENTITY_CHANGED`.
   */
  entityId: string;
  apply: () => Promise<HealthEntityState>;
  onError?: (error: unknown) => void;
  /**
   * Optional per-`entityId` critical section wrapping the snapshot-prev +
   * apply + diff + emit. The executor supplies a transaction-scoped advisory
   * lock (`withXactLock`, key `health:<entityId>`) so concurrent evaluations
   * of one (system, environment) — or of the rollup — can't double-emit a
   * single logical transition, and per-env + rollup writes serialize against
   * their OWN keys (distinct envs / the rollup don't block each other).
   * Identity by default (no serialization) for the unbound-handle / test paths.
   */
  serialize?: <T>(fn: () => Promise<T>) => Promise<T>;
}): Promise<HealthEntityState> {
  const { handle, entityId, apply, onError, serialize } = args;
  if (!handle) {
    // No reactivity bound — run the durable write directly.
    return apply();
  }
  const run = serialize ?? (<T>(fn: () => Promise<T>) => fn());
  let durableState: HealthEntityState | undefined;
  try {
    // The lock scope MUST cover prev-snapshot through emit: `handle.mutate`
    // snapshots `prev` via `read`, runs `apply`, diffs, and emits inside one
    // call, and we wrap that whole call so two concurrent evals serialize.
    return await run(() =>
      handle.mutate({
        id: entityId,
        apply: async () => {
          durableState = await apply();
          return durableState;
        },
      }),
    );
  } catch (error) {
    // `apply` never committed ⇒ the durable write failed; propagate so the
    // executor's outer catch can run its fallback path.
    if (durableState === undefined) throw error;
    // Durable write committed; only the framework reactivity failed. Fail-soft.
    onError?.(error);
    return durableState;
  }
}

/**
 * Advisory-lock key namespace for the per-entity health critical section. The
 * argument is the FULL `health` entity id (Phase 3b): the bare `"<systemId>"`
 * for the rollup or `"<systemId>::<environmentId>"` for a per-env write. Two
 * different envs (or an env vs the rollup) get DIFFERENT keys, so they
 * serialize independently and never block each other.
 */
export function healthEntityLockKey(entityId: string): string {
  return `health:${entityId}`;
}

/**
 * Build the per-`entityId` serializer for {@link writeHealthEntity} backed by
 * a transaction-scoped advisory lock (`withXactLock`, key
 * `health:<entityId>`). The returned function blocks until it holds the
 * entity's lock, runs `fn` (the whole snapshot-prev + apply + diff + emit), and
 * auto-releases the lock at COMMIT/ROLLBACK. Two concurrent evaluations of one
 * (system, environment) — or of the rollup — therefore serialize, while
 * distinct envs proceed in parallel. Exactly one logical transition per entity
 * emits exactly one `ENTITY_CHANGED` + one transition row.
 *
 * `fn` does its own durable writes on the outer pool; the lock only gates
 * ENTRY to the critical section, so its connection affinity is irrelevant —
 * the second caller cannot acquire the xact lock until the first transaction
 * commits.
 */
export function createHealthEntitySerializer(deps: {
  advisoryLock: AdvisoryLockService;
}): (entityId: string) => <T>(fn: () => Promise<T>) => Promise<T> {
  const { advisoryLock } = deps;
  return (entityId) =>
    <T>(fn: () => Promise<T>) =>
      advisoryLock.withXactLock({
        key: healthEntityLockKey(entityId),
        fn: () => fn(),
      });
}
