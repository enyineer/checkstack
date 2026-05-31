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
import { eq } from "drizzle-orm";
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  EntityChangeDeriver,
  EntityHandle,
  EntityRead,
} from "@checkstack/automation-backend";
import type { HealthCheckService } from "./service";
import { healthCheckRuns } from "./schema";
import * as schema from "./schema";
// Re-export the change type through automation-backend's barrel (it
// re-exports it from automation-common) so this domain needs no extra dep.

type Db = SafeDatabase<typeof schema>;

/** Entity kind id for the per-system aggregated health. */
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
  const previousStatus = readStatus(changed.prev);
  const newStatus = readStatus(changed.next);
  const bothPresent = previousStatus !== null && newStatus !== null;
  const degraded =
    bothPresent && previousStatus === "healthy" && newStatus !== "healthy";
  const recovered =
    bothPresent && newStatus === "healthy" && previousStatus !== "healthy";
  return {
    systemId: changed.id,
    previousStatus,
    newStatus,
    degraded,
    recovered,
  };
}

/**
 * Whether the system has at least one persisted `health_check_runs` row.
 *
 * This is the EXISTENCE GATE for the computed entity: a system with no runs
 * yet has no `health` entity (the `read` omits it). It reproduces the old
 * keyed-store semantic where the entity row only appeared on the FIRST mirror
 * (i.e. after the first run was persisted), so a system's very first
 * evaluation is a create (`prev === null`) and fires no directional/umbrella
 * event. Once any run exists, the entity is resolvable on every read.
 */
async function systemHasRuns(args: {
  db: Db;
  systemId: string;
}): Promise<boolean> {
  const { db, systemId } = args;
  const [row] = await db
    .select({ id: healthCheckRuns.id })
    .from(healthCheckRuns)
    .where(eq(healthCheckRuns.systemId, systemId))
    .limit(1);
  return row !== undefined;
}

/**
 * Compute the reactive `health` view for a single system from durable data.
 *
 * Derives `{ status, healthyChecks, totalChecks }` exactly as the old
 * evaluation-site mirror did:
 *  - `status`         = `getSystemHealthStatus(systemId).status` (the worst-
 *    wins aggregate across the system's ENABLED checks, computed from
 *    `health_check_runs` via `evaluateHealthStatus`),
 *  - `healthyChecks`  = count of per-check statuses that are `"healthy"`,
 *  - `totalChecks`    = number of enabled checks (`checkStatuses.length`).
 *
 * Returns `undefined` when the system has no persisted runs yet (existence
 * gate — see {@link systemHasRuns}); missing ids are omitted from the batched
 * `read`.
 */
export async function computeHealthEntityState(args: {
  db: Db;
  service: HealthCheckService;
  systemId: string;
}): Promise<HealthEntityState | undefined> {
  const { db, service, systemId } = args;
  if (!(await systemHasRuns({ db, systemId }))) return undefined;
  const overview = await service.getSystemHealthStatus(systemId);
  return {
    status: overview.status,
    healthyChecks: overview.checkStatuses.filter((c) => c.status === "healthy")
      .length,
    totalChecks: overview.checkStatuses.length,
  };
}

/**
 * Build the PLUGIN-BACKED + COMPUTED `read` accessor for the `health` entity.
 * For each systemId, assembles the view via {@link computeHealthEntityState}
 * (systems with no runs omitted). This is the single source of truth that
 * `handle.mutate` snapshots `prev` from and `get`/`getMany`/scope enrichment
 * route through — no framework `entity_state` storage.
 */
export function createHealthEntityRead(deps: {
  db: Db;
  service: HealthCheckService;
}): EntityRead<HealthEntityState> {
  const { db, service } = deps;
  return async (ids) => {
    if (ids.length === 0) return {};
    const out: Record<string, HealthEntityState> = {};
    await Promise.all(
      ids.map(async (systemId) => {
        const state = await computeHealthEntityState({ db, service, systemId });
        if (state) out[systemId] = state;
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
 * Failure handling:
 *  - When no `handle` is bound (version skew / tests), `apply` still runs —
 *    the durable write is never gated on entity reactivity.
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
  systemId: string;
  apply: () => Promise<HealthEntityState>;
  onError?: (error: unknown) => void;
}): Promise<HealthEntityState> {
  const { handle, systemId, apply, onError } = args;
  if (!handle) {
    // No reactivity bound — run the durable write directly.
    return apply();
  }
  let durableState: HealthEntityState | undefined;
  try {
    return await handle.mutate({
      id: systemId,
      apply: async () => {
        durableState = await apply();
        return durableState;
      },
    });
  } catch (error) {
    // `apply` never committed ⇒ the durable write failed; propagate so the
    // executor's outer catch can run its fallback path.
    if (durableState === undefined) throw error;
    // Durable write committed; only the framework reactivity failed. Fail-soft.
    onError?.(error);
    return durableState;
  }
}
