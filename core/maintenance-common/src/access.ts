import { access, accessPair } from "@checkstack/common";

/**
 * Access rules for the Maintenance plugin.
 */
export const maintenanceAccess = {
  /**
   * Maintenance access with both read and manage levels.
   * Read is public by default.
   * Uses system-level instance access for team-based filtering.
   */
  maintenance: accessPair(
    "maintenance",
    {
      read: "View planned maintenances",
      manage:
        "Manage planned maintenances - create, edit, delete, and add updates",
    },
    {
      idParam: "systemId",
      readIsDefault: true,
      readIsPublic: true,
    }
  ),

  /**
   * Bulk maintenance access for viewing maintenances for multiple systems.
   * Uses recordKey for filtering the output record by accessible system IDs.
   */
  bulkMaintenance: access(
    "maintenance.maintenance",
    "read",
    "View planned maintenances",
    {
      recordKey: "maintenances",
      isDefault: true,
      isPublic: true,
    }
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const maintenanceAccessRules = [
  maintenanceAccess.maintenance.read,
  maintenanceAccess.maintenance.manage,
];
