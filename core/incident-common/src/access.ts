import { accessPair, resourceType } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the incident plugin's resources.
 * Reference these (never a raw `"incident.incident"` string) at capability call
 * sites so a typo fails typecheck.
 */
export const incidentResourceTypes = {
  incident: resourceType(pluginMetadata, "incident"),
};

/**
 * Access rules for the Incident plugin.
 */
export const incidentAccess = {
  /**
   * Incident access with both read and manage levels.
   * Read is public by default.
   * Uses system-level instance access for team-based filtering.
   *
   * Bulk endpoints should use the same access rule with instanceAccess
   * override at the contract level.
   */
  incident: accessPair(
    "incident",
    {
      read: {
        description: "View incidents",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description: "Manage incidents - create, edit, resolve, and delete",
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
export const incidentAccessRules = [
  incidentAccess.incident.read,
  incidentAccess.incident.manage,
];
