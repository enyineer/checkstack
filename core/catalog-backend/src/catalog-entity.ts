/**
 * The reactive `catalog-system` + `catalog-group` entities (reactive
 * automation engine §10.4).
 *
 * Behavior-preserving MIRROR: the catalog `systems` / `groups` tables stay
 * authoritative; the router/action mutation sites ALSO mirror the reactive
 * subset into the framework entity store so automations + scope see catalog
 * lifecycle reactively. The change → trigger-event derivers reproduce the
 * existing `catalog.system.created/.updated/.deleted` +
 * `catalog.group.created/.deleted` qualified events so automations keep
 * firing.
 */
import { z } from "zod";
import type {
  EntityChangeDeriver,
  EntityHandle,
} from "@checkstack/automation-backend";

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
 * lifecycle event. A no-op diff never reaches a deriver (the entity store
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

/** Mirror a catalog system into the `catalog-system` entity (fail-soft). */
export async function mirrorCatalogSystem(args: {
  handle: EntityHandle<CatalogSystemState> | undefined;
  systemId: string;
  name: string;
  description: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, systemId, name, description, metadata, onError } = args;
  if (!handle) return;
  try {
    await handle.set(systemId, {
      name,
      description: description ?? null,
      metadata: metadata ?? {},
    });
  } catch (error) {
    onError?.(error);
  }
}

/** Mirror a catalog group into the `catalog-group` entity (fail-soft). */
export async function mirrorCatalogGroup(args: {
  handle: EntityHandle<CatalogGroupState> | undefined;
  groupId: string;
  name: string;
  metadata: Record<string, unknown> | null | undefined;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, groupId, name, metadata, onError } = args;
  if (!handle) return;
  try {
    await handle.set(groupId, { name, metadata: metadata ?? {} });
  } catch (error) {
    onError?.(error);
  }
}

/** Remove a catalog entity (tombstone) — fail-soft. */
export async function removeCatalogEntity<
  TState extends Record<string, unknown>,
>(args: {
  handle: EntityHandle<TState> | undefined;
  id: string;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, id, onError } = args;
  if (!handle) return;
  try {
    await handle.remove(id);
  } catch (error) {
    onError?.(error);
  }
}
