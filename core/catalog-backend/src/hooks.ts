import { createHook } from "@checkmate-monitor/backend-api";

/**
 * Catalog hooks for cross-plugin communication
 */
export const catalogHooks = {
  /**
   * Emitted when a system is deleted.
   * Plugins can subscribe (work-queue mode) to clean up related data.
   */
  systemDeleted: createHook<{
    systemId: string;
    systemName?: string;
  }>("catalog.system.deleted"),

  /**
   * Emitted when a group is deleted.
   * Plugins can subscribe (work-queue mode) to clean up related data.
   */
  groupDeleted: createHook<{
    groupId: string;
    groupName?: string;
  }>("catalog.group.deleted"),
} as const;
