/**
 * The reactive `health` entity (reactive automation engine §10.3).
 *
 * A behavior-preserving MIRROR of the per-system aggregated health: the
 * healthcheck domain keeps computing + storing aggregate state the way it
 * always has (the `health_check_*` tables stay authoritative), and ALSO
 * mirrors the reactive subset `{ status, healthyChecks, totalChecks }` into
 * the framework entity store keyed by `systemId`. The entity store is the
 * reactive projection consumed by automations / scope; the domain remains
 * the record of truth for everything else.
 *
 * This module is the single source of truth for:
 *  - the `health` entity zod state schema + kind id,
 *  - the change → trigger-event deriver (so the existing
 *    `healthcheck.system.degraded` / `.healthy` / `.health_changed`
 *    automations keep firing), and
 *  - the `mirrorHealthEntity` helper called at every aggregate-write site.
 */
import { z } from "zod";
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";
import type {
  EntityChangeDeriver,
  EntityHandle,
} from "@checkstack/automation-backend";
// Re-export the change type through automation-backend's barrel (it
// re-exports it from automation-common) so this domain needs no extra dep.

/** Entity kind id for the per-system aggregated health. */
export const HEALTH_ENTITY_KIND = "health";

/**
 * Reactive state subset mirrored into the entity store. The full aggregate
 * (per-check breakdown, timestamps, etc.) stays in the domain tables; only
 * the fields automations reason about live here.
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
 * Mirror the aggregated health of one system into the `health` entity.
 *
 * Fail-soft: a mirror failure must never break the health-check execution
 * path (the domain tables already captured the authoritative state). The
 * caller passes the resolved handle (or `undefined` during version skew /
 * tests) plus the freshly-computed aggregate.
 */
export async function mirrorHealthEntity(args: {
  handle: EntityHandle<HealthEntityState> | undefined;
  systemId: string;
  status: HealthEntityState["status"];
  healthyChecks: number;
  totalChecks: number;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, systemId, status, healthyChecks, totalChecks, onError } =
    args;
  if (!handle) return;
  try {
    await handle.set(systemId, { status, healthyChecks, totalChecks });
  } catch (error) {
    onError?.(error);
  }
}
