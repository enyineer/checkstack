/**
 * The reactive `catalog-system` + `catalog-group` entities (reactive
 * automation engine §10.4).
 *
 * Model B PLUGIN-BACKED entities: the catalog `systems` / `groups` tables
 * are authoritative AND ARE the entities' current-state storage — there is
 * NO framework `entity_state` row for a catalog system/group.
 * `defineEntity({ read })` makes that plugin state reactive: every
 * reactive-state write goes through `handle.mutate`, whose `apply()` performs
 * the REAL `systems`/`groups` write via the catalog `EntityService` (the
 * plugin's own db/tx) and returns the resulting reactive subset. The
 * framework snapshots `prev` via `read`, appends the transition log (its own
 * db), and emits `ENTITY_CHANGED`. The change → trigger-event derivers
 * reproduce `catalog.created/.updated/.deleted` +
 * `catalog.group.created/.deleted` so automations keep firing.
 */
import { z } from "zod";
import type {
  EntityChangeDeriver,
  EntityChangePayloadMapper,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
} from "@checkstack/automation-backend";
import {
  withEntityRemove,
  withEntityWrite,
} from "@checkstack/automation-backend";

import type { EntityService } from "./services/entity-service";

export const CATALOG_SYSTEM_ENTITY_KIND = "catalog-system";
export const CATALOG_GROUP_ENTITY_KIND = "catalog-group";

/** Reactive state for a catalog system. */
export const CatalogSystemStateSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type CatalogSystemState = z.infer<typeof CatalogSystemStateSchema>;

/** Reactive state for a catalog group. */
export const CatalogGroupStateSchema = z.object({
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export type CatalogGroupState = z.infer<typeof CatalogGroupStateSchema>;

/**
 * Qualified TRIGGER event ids (`${pluginId}.${trigger.id}`) that automations
 * store in `trigger.event` and Stage-1 routing matches on — NOT the dotted
 * hook ids. The catalog system triggers use ids `created`/`updated`/`deleted`
 * (pluginId `catalog`), so the deriver emits `catalog.created` etc., not the
 * hook id `catalog.system.created`. (Verified against `automations.ts`.)
 *
 * There are NO registered catalog GROUP triggers today, so the group deriver
 * fires nothing that any automation matches — kept for forward-compat + so
 * group changes still drive scope/wake resolution as a known reactive kind.
 */
export const CATALOG_SYSTEM_TRIGGER_EVENTS = {
  created: "catalog.created",
  updated: "catalog.updated",
  deleted: "catalog.deleted",
} as const;

export const CATALOG_GROUP_TRIGGER_EVENTS = {
  created: "catalog.group.created",
  deleted: "catalog.group.deleted",
} as const;

/**
 * `catalog-system` change → trigger events. Create (`prev === null`),
 * tombstone (`next === null`), or a field update map to the matching
 * lifecycle event. A no-op diff never reaches a deriver (the handle
 * suppresses it), so an update always carries a real change.
 */
export const deriveCatalogSystemTriggerEvents: EntityChangeDeriver = (
  changed,
) => {
  if (changed.prev === null && changed.next !== null) {
    return [CATALOG_SYSTEM_TRIGGER_EVENTS.created];
  }
  if (changed.next === null) {
    return [CATALOG_SYSTEM_TRIGGER_EVENTS.deleted];
  }
  return [CATALOG_SYSTEM_TRIGGER_EVENTS.updated];
};

/**
 * `catalog-group` change → trigger events. Only create + delete have
 * matching hooks today (there is no `catalog.group.updated`), so a pure
 * update diff fires nothing.
 */
export const deriveCatalogGroupTriggerEvents: EntityChangeDeriver = (
  changed,
) => {
  if (changed.prev === null && changed.next !== null) {
    return [CATALOG_GROUP_TRIGGER_EVENTS.created];
  }
  if (changed.next === null) {
    return [CATALOG_GROUP_TRIGGER_EVENTS.deleted];
  }
  return [];
};

/** The catalog `system.updated` trigger's `changedFields` enum members. */
const CATALOG_SYSTEM_CHANGED_FIELDS = ["name", "description", "metadata"] as const;

function readName(state: Record<string, unknown> | null): string | undefined {
  if (state === null) return undefined;
  const name = state["name"];
  return typeof name === "string" ? name : undefined;
}

/**
 * Map a `catalog-system` change to the domain-named `trigger.payload` the
 * catalog system triggers declare via `payloadSchema` (`systemId`,
 * `systemName`, `changedFields`). Restores the keys operators read
 * (`trigger.payload.systemId`, `.systemName`, `.changedFields`) that the
 * generic change shape omits.
 *
 * `systemId` is the entity id; `systemName` is `next.name` (absent on a
 * tombstone, where the `deleted` schema marks it optional); `changedFields` is
 * the change's `changedFields` intersected with the system trigger enum
 * (`name` / `description` / `metadata`).
 */
export const catalogSystemChangeToPayload: EntityChangePayloadMapper = (
  changed,
) => {
  const changedFields = changed.changedFields.filter(
    (f): f is (typeof CATALOG_SYSTEM_CHANGED_FIELDS)[number] =>
      (CATALOG_SYSTEM_CHANGED_FIELDS as readonly string[]).includes(f),
  );
  const systemName = readName(changed.next);
  return {
    systemId: changed.id,
    ...(systemName === undefined ? {} : { systemName }),
    changedFields,
  };
};

/**
 * Map a `catalog-group` change to a domain-named `trigger.payload`
 * (`groupId`, `groupName`). There are NO registered catalog GROUP triggers
 * today, so this fires for no automation yet — it is supplied for forward
 * compatibility + parity so a group change carries the same domain shape the
 * other kinds do when group triggers are added.
 */
export const catalogGroupChangeToPayload: EntityChangePayloadMapper = (
  changed,
) => {
  const groupName = readName(changed.next);
  return {
    groupId: changed.id,
    ...(groupName === undefined ? {} : { groupName }),
  };
};

/**
 * Build the PLUGIN-BACKED `read` accessor for the `catalog-system` entity.
 * Routes straight to the service's batched authoritative read over the
 * `systems` table — no framework storage.
 */
export function createCatalogSystemEntityRead(
  service: EntityService,
): EntityRead<CatalogSystemState> {
  return (ids) => service.getManySystemEntityStates(ids);
}

/**
 * Build the PLUGIN-BACKED `read` accessor for the `catalog-group` entity.
 * Routes straight to the service's batched authoritative read over the
 * `groups` table — no framework storage.
 */
export function createCatalogGroupEntityRead(
  service: EntityService,
): EntityRead<CatalogGroupState> {
  return (ids) => service.getManyGroupEntityStates(ids);
}

/**
 * Project a catalog system row onto the reactive `{ name, description,
 * metadata }` subset. The router's service writes return the full row; this
 * is the `apply()` return for `handle.mutate`.
 */
export function toCatalogSystemState(system: {
  name: string;
  description: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}): CatalogSystemState {
  return {
    name: system.name,
    description: system.description ?? null,
    metadata: system.metadata ?? {},
  };
}

/**
 * Project a catalog group row onto the reactive `{ name, metadata }` subset.
 */
export function toCatalogGroupState(group: {
  name: string;
  metadata: Record<string, unknown> | null | undefined;
}): CatalogGroupState {
  return {
    name: group.name,
    metadata: group.metadata ?? {},
  };
}

/**
 * Drive a reactive-state `catalog-system` write through `handle.mutate`
 * (§10.4). `apply` performs the REAL `systems` write via the service (the
 * plugin's own db/tx) and returns the new reactive state. The framework
 * snapshots `prev`, appends the transition log, and emits `ENTITY_CHANGED`
 * (the deriver turns that into `catalog.created/.updated`).
 *
 * When no handle is available (tests construct the router without one), the
 * write still runs — the entity reactivity is layered on top, never required
 * for the underlying write to succeed.
 */
export async function writeCatalogSystemEntity(args: {
  handle: EntityHandle<CatalogSystemState> | undefined;
  systemId: string;
  /**
   * Mutation context (actor / runId). When the write originates inside a
   * dispatch run (e.g. `system.update_metadata`), pass `opts: { runId }` so a
   * run-resolved secret that lands in `metadata` is masked in the
   * `entity_transitions` rows + the cluster-wide `ENTITY_CHANGED` — `metadata`
   * is `z.record(z.string(), z.unknown())`, the only reactive catalog field
   * that can carry an arbitrary secret string.
   */
  opts?: EntityMutationOpts;
  apply: () => Promise<CatalogSystemState>;
}): Promise<void> {
  const { handle, systemId, opts, apply } = args;
  await withEntityWrite({ handle, id: systemId, opts, apply });
}

/**
 * Drive a reactive-state `catalog-group` write through `handle.mutate`
 * (§10.4). Mirrors {@link writeCatalogSystemEntity} for the group kind.
 */
export async function writeCatalogGroupEntity(args: {
  handle: EntityHandle<CatalogGroupState> | undefined;
  groupId: string;
  /** Mutation context (actor / runId) — see {@link writeCatalogSystemEntity}. */
  opts?: EntityMutationOpts;
  apply: () => Promise<CatalogGroupState>;
}): Promise<void> {
  const { handle, groupId, opts, apply } = args;
  await withEntityWrite({ handle, id: groupId, opts, apply });
}

/**
 * Drive a catalog entity tombstone through `handle.remove` (§10.4). `apply`
 * performs the REAL delete via the service; the framework records the
 * tombstone transition and emits a tombstone change (the deriver fires
 * `catalog.deleted` / `catalog.group.deleted`). Without a handle, the delete
 * still runs.
 */
export async function removeCatalogEntity<
  TState extends Record<string, unknown>,
>(args: {
  handle: EntityHandle<TState> | undefined;
  id: string;
  /** Mutation context (actor / runId) — see {@link writeCatalogSystemEntity}. */
  opts?: EntityMutationOpts;
  apply: () => Promise<void>;
}): Promise<void> {
  const { handle, id, opts, apply } = args;
  await withEntityRemove({ handle, id, opts, apply });
}
