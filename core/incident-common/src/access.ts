import { access, accessPair } from "@checkstack/common";

/**
 * Access rules for the Incident plugin.
 */
export const incidentAccess = {
  /**
   * Incident access with both read and manage levels.
   * Read is public by default.
   * Uses system-level instance access for team-based filtering.
   */
  incident: accessPair(
    "incident",
    {
      read: "View incidents",
      manage: "Manage incidents - create, edit, resolve, and delete",
    },
    {
      idParam: "systemId",
      readIsDefault: true,
      readIsPublic: true,
    }
  ),

  /**
   * Bulk incident access for viewing incidents for multiple systems.
   * Uses recordKey for filtering the output record by accessible system IDs.
   */
  bulkIncident: access("incident.incident", "read", "View incidents", {
    recordKey: "incidents",
    isDefault: true,
    isPublic: true,
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const incidentAccessRules = [
  incidentAccess.incident.read,
  incidentAccess.incident.manage,
];
