/**
 * Maintenance reactive entity (reactive automation engine §10.2).
 *
 * Phase 4 migrates the maintenance domain onto the framework-owned entity
 * state machine. Mutation sites that used to `emitHook(maintenanceCreated /
 * maintenanceUpdated)` now ALSO mirror the maintenance window's reactive
 * state into the `maintenance` entity via `handle.set` (a behaviour-
 * preserving mirror — the `maintenances` table stays the record of truth).
 *
 * The old `maintenance.created` / `maintenance.updated` hooks are removed;
 * the change-deriver below maps an entity change back to the SAME qualified
 * trigger event ids existing automations match (`maintenance.created` /
 * `maintenance.updated`), so Stage-1 routing keeps firing them.
 */
import { z } from "zod";
import {
  MaintenanceStatusEnum,
  type MaintenanceStatus,
} from "@checkstack/maintenance-common";
import type { EntityChanged } from "@checkstack/automation-common";

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
 * `startAt` / `endAt` are ISO strings (the entity store persists JSON, so the
 * service's `Date` columns are serialized at the mirror site).
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
 * Build the mirror state from a freshly-written maintenance row. Accepts
 * either `Date` (service return shape) or already-ISO strings.
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
    startAt: row.startAt instanceof Date ? row.startAt.toISOString() : row.startAt,
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
