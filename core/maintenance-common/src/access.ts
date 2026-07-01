import { accessPair, resourceType } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the maintenance plugin's resources.
 * Reference these (never a raw `"maintenance.maintenance"` string) at capability
 * call sites so a typo fails typecheck.
 */
export const maintenanceResourceTypes = {
  maintenance: resourceType(pluginMetadata, "maintenance"),
};

/**
 * Access rules for the Maintenance plugin.
 */
export const maintenanceAccess = {
  /**
   * Maintenance access with both read and manage levels.
   * Read is public by default.
   * Uses system-level instance access for team-based filtering.
   *
   * Bulk endpoints should use the same access rule with instanceAccess
   * override at the contract level.
   */
  maintenance: accessPair(
    "maintenance",
    {
      read: {
        description: "View planned maintenances",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description:
          "Manage planned maintenances - create, edit, delete, and add updates",
      },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const maintenanceAccessRules = [
  maintenanceAccess.maintenance.read,
  maintenanceAccess.maintenance.manage,
];
