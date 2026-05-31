/**
 * The reactive `maintenance` entity (reactive automation engine §10.2).
 *
 * Model B PLUGIN-BACKED entity: the `maintenances` + `maintenance_systems`
 * tables are authoritative AND ARE the entity's current-state storage — there
 * is NO framework `entity_state` row for a maintenance window.
 * `defineEntity({ read })` makes that plugin state reactive: every
 * reactive-state write goes through `handle.mutate`, whose `apply()` performs
 * the REAL `maintenances`/junction write via the maintenance service (the
 * plugin's own db/tx) and returns the resulting `{ status, systemIds, startAt,
 * endAt }`. The framework snapshots `prev` via `read`, appends the transition
 * log (its own db), and emits `ENTITY_CHANGED`. The change → trigger-event
 * deriver reproduces `maintenance.created` / `.updated` so automations keep
 * firing.
 */
import { z } from "zod";
import {
  MaintenanceStatusEnum,
  type MaintenanceStatus,
} from "@checkstack/maintenance-common";
import type {
  EntityChanged,
  EntityChangePayloadMapper,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
} from "@checkstack/automation-backend";
import {
  withEntityRemove,
  withEntityWrite,
} from "@checkstack/automation-backend";

import type { MaintenanceService } from "./service";

/** Globally-unique entity kind for a maintenance window. */
export const MAINTENANCE_ENTITY_KIND = "maintenance";

/**
 * Qualified trigger event ids the deriver maps to — `${pluginId}.${triggerId}`
 * for the (now-removed) `created` / `updated` triggers. Automations reference
 * these strings in `definition.triggers[].event`, so the deriver MUST return
 * them verbatim for Stage-1 routing to match.
 */
export const MAINTENANCE_CREATED_EVENT = "maintenance.created";
export const MAINTENANCE_UPDATED_EVENT = "maintenance.updated";

/**
 * Reactive state of a maintenance window (reactive automation engine §10.2).
 * `startAt` / `endAt` are ISO strings (the `read` accessor serializes the
 * service's `Date` columns; the `apply()` return uses {@link
 * toMaintenanceEntityState} to do the same).
 */
export const maintenanceEntityStateSchema = z.object({
  status: MaintenanceStatusEnum,
  systemIds: z.array(z.string()),
  startAt: z.string(),
  endAt: z.string(),
});

export type MaintenanceEntityState = z.infer<
  typeof maintenanceEntityStateSchema
>;

/**
 * Project a freshly-written maintenance row onto the reactive `{ status,
 * systemIds, startAt, endAt }` subset. Accepts either `Date` (service return
 * shape) or already-ISO strings. This is the `apply()` return for
 * `handle.mutate`.
 */
export function toMaintenanceEntityState(row: {
  status: MaintenanceStatus;
  systemIds: string[];
  startAt: Date | string;
  endAt: Date | string;
}): MaintenanceEntityState {
  return {
    status: row.status,
    systemIds: row.systemIds,
    startAt:
      row.startAt instanceof Date ? row.startAt.toISOString() : row.startAt,
    endAt: row.endAt instanceof Date ? row.endAt.toISOString() : row.endAt,
  };
}

/**
 * Map a `maintenance` entity change to the qualified trigger event id(s) it
 * should fire (reactive automation engine §7, Stage-1 routing):
 *
 *   - create (`prev === null`)            → `maintenance.created`
 *   - update (a real diff, prev present)  → `maintenance.updated`
 *   - remove (tombstone, `next === null`) → nothing (the old domain never
 *     emitted a hook on delete)
 *
 * The deriver never sees no-op writes — the handle only emits a change event
 * on a real diff — so a plain non-tombstone change is always a meaningful
 * `created`/`updated`.
 */
export function deriveMaintenanceEvents(
  changed: EntityChanged,
): ReadonlyArray<string> {
  if (changed.next === null) {
    // Tombstone — delete fired no maintenance hook historically.
    return [];
  }
  if (changed.prev === null) {
    return [MAINTENANCE_CREATED_EVENT];
  }
  return [MAINTENANCE_UPDATED_EVENT];
}

/**
 * Map a `maintenance` entity change to the domain-named `trigger.payload` the
 * maintenance triggers declare via `payloadSchema` (`maintenanceId`, `status`,
 * `systemIds`, `startAt`, `endAt`). Restores the keys operators read
 * (`trigger.payload.maintenanceId`, `.status`, …) that the generic change shape
 * omits, so an entity-driven maintenance trigger sees the same documented
 * payload the four migrated lifecycle domains do.
 *
 * `maintenanceId` is the entity id; the remaining fields read off `next` (a
 * tombstone fires no event, so `next` is always present when a trigger fires).
 * The reactive subset is `{ status, systemIds, startAt, endAt }`, so the
 * descriptive fields the old hook carried (`title`, `description`) are NOT
 * derivable from a change and are declared OPTIONAL on the payload schemas.
 */
export const maintenanceChangeToPayload: EntityChangePayloadMapper = (
  changed,
) => {
  const next = changed.next;
  const systemIds = next === null ? undefined : next["systemIds"];
  const readString = (field: string): unknown =>
    next === null ? undefined : next[field];
  return {
    maintenanceId: changed.id,
    status: readString("status"),
    systemIds: Array.isArray(systemIds) ? systemIds : [],
    startAt: readString("startAt"),
    endAt: readString("endAt"),
  };
};

/**
 * Build the PLUGIN-BACKED `read` accessor for the `maintenance` entity. Routes
 * straight to the service's batched authoritative read — no framework storage.
 */
export function createMaintenanceEntityRead(
  service: MaintenanceService,
): EntityRead<MaintenanceEntityState> {
  return (ids) => service.getManyEntityStates(ids);
}

/**
 * Drive a reactive-state maintenance write through `handle.mutate` (§10.2).
 * `apply` performs the REAL `maintenances`/junction write via the service (the
 * plugin's own db/tx) and returns the new reactive state. The framework
 * snapshots `prev`, appends the transition log, and emits `ENTITY_CHANGED`
 * (the deriver turns that into `maintenance.created/.updated`).
 *
 * When no handle is available (tests construct the router without one), the
 * write still runs — the entity reactivity is layered on top, never required
 * for the underlying write to succeed.
 */
export async function writeMaintenanceEntity(args: {
  handle: EntityHandle<MaintenanceEntityState> | undefined;
  maintenanceId: string;
  opts?: EntityMutationOpts;
  apply: () => Promise<MaintenanceEntityState>;
}): Promise<void> {
  const { handle, maintenanceId, opts, apply } = args;
  await withEntityWrite({ handle, id: maintenanceId, opts, apply });
}

/**
 * Drive a maintenance tombstone through `handle.remove` (§10.2). `apply`
 * performs the REAL delete via the service; the framework records the
 * tombstone transition and emits a tombstone change (the deriver fires
 * nothing — the old domain never emitted a hook on delete). Without a handle,
 * the delete still runs.
 */
export async function removeMaintenanceEntity(args: {
  handle: EntityHandle<MaintenanceEntityState> | undefined;
  maintenanceId: string;
  opts?: EntityMutationOpts;
  apply: () => Promise<void>;
}): Promise<void> {
  const { handle, maintenanceId, opts, apply } = args;
  await withEntityRemove({ handle, id: maintenanceId, opts, apply });
}
