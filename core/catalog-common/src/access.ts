import { accessPair } from "@checkstack/common";

/**
 * Access rules for the Catalog plugin.
 *
 * Systems have instance-level access control (team-based filtering).
 * Groups and views are global (no team-based filtering).
 */
export const catalogAccess = {
  /**
   * System access with team-based filtering.
   * - Read: View systems (filtered by team grants if no global access)
   * - Manage: Create, update, delete systems
   */
  system: accessPair(
    "system",
    {
      read: {
        description: "View systems in catalog",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description: "Create, update, and delete systems",
      },
    },
    {
      idParam: "systemId",
      listKey: "systems",
    },
  ),

  /**
   * Group access (global, no team-based filtering).
   */
  group: accessPair("group", {
    read: {
      description: "View groups",
      isDefault: true,
      isPublic: true,
    },
    manage: {
      description: "Create, update, and delete groups",
    },
  }),

  /**
   * View access (global, user-only).
   */
  view: accessPair("view", {
    read: {
      description: "View saved views",
      isDefault: true,
    },
    manage: {
      description: "Manage saved views",
    },
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const catalogAccessRules = [
  catalogAccess.system.read,
  catalogAccess.system.manage,
  catalogAccess.group.read,
  catalogAccess.group.manage,
  catalogAccess.view.read,
  catalogAccess.view.manage,
];
