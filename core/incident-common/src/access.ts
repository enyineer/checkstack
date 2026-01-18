import { accessPair } from "@checkstack/common";

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
      idParam: "systemId",
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
