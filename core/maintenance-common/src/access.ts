import { accessPair } from "@checkstack/common";

/**
 * Access rules for the Maintenance plugin.
 */
export const maintenanceAccess = {
  /**
   * Maintenance access with both read and manage levels.
   * Read is public by default.
   */
  maintenance: accessPair(
    "maintenance",
    {
      read: "View planned maintenances",
      manage:
        "Manage planned maintenances - create, edit, delete, and add updates",
    },
    {
      readIsDefault: true,
      readIsPublic: true,
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
