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
      read: "View systems in catalog",
      manage: "Create, update, and delete systems",
    },
    {
      idParam: "systemId",
      listKey: "systems",
      readIsDefault: true,
      readIsPublic: true,
    }
  ),

  /**
   * Group access (global, no team-based filtering).
   */
  group: accessPair(
    "group",
    {
      read: "View groups",
      manage: "Create, update, and delete groups",
    },
    {
      readIsDefault: true,
      readIsPublic: true,
    }
  ),

  /**
   * View access (global, user-only).
   */
  view: accessPair(
    "view",
    {
      read: "View saved views",
      manage: "Manage saved views",
    },
    {
      readIsDefault: true,
    }
  ),
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
