import { createHook } from "@checkstack/backend-api";

/**
 * Catalog hooks for cross-plugin communication
 */
export const catalogHooks = {
  /**
   * Emitted when a system is created.
   * Plugins can subscribe (work-queue mode) to bootstrap related state
   * (e.g. per-system notification groups).
   */
  systemCreated: createHook<{
    systemId: string;
    systemName: string;
  }>("catalog.system.created"),

  /**
   * Emitted when a system's name, description, or metadata changes.
   *
   * `changedFields` lists the keys the caller actually set on the
   * update (excluding `id`), so subscribers can route on field-level
   * changes (e.g. "only react to metadata edits") without diffing the
   * full record.
   */
  systemUpdated: createHook<{
    systemId: string;
    systemName: string;
    changedFields: Array<"name" | "description" | "metadata">;
  }>("catalog.system.updated"),

  /**
   * Emitted when a system is deleted.
   * Plugins can subscribe (work-queue mode) to clean up related data.
   */
  systemDeleted: createHook<{
    systemId: string;
    systemName?: string;
  }>("catalog.system.deleted"),

  /**
   * Emitted when a catalog group is created.
   * Plugins can subscribe to bootstrap related state (e.g. anomaly creates
   * its own per-group notification group on this signal).
   */
  groupCreated: createHook<{
    groupId: string;
    groupName: string;
  }>("catalog.group.created"),

  /**
   * Emitted when a group is deleted.
   * Plugins can subscribe (work-queue mode) to clean up related data.
   */
  groupDeleted: createHook<{
    groupId: string;
    groupName?: string;
  }>("catalog.group.deleted"),
} as const;
