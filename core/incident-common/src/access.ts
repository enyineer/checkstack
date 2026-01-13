import { accessPair } from "@checkstack/common";

/**
 * Access rules for the Incident plugin.
 */
export const incidentAccess = {
  /**
   * Incident access with both read and manage levels.
   * Read is public by default.
   */
  incident: accessPair(
    "incident",
    {
      read: "View incidents",
      manage: "Manage incidents - create, edit, resolve, and delete",
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
export const incidentAccessRules = [
  incidentAccess.incident.read,
  incidentAccess.incident.manage,
];
