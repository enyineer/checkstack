import { access, accessPair } from "@checkstack/common";

/**
 * Access rules for the Health Check plugin.
 */
export const healthCheckAccess = {
  /**
   * Status-only access for viewing health check status.
   * Enabled by default for anonymous and authenticated users.
   * Uses system-level instance access for team-based filtering.
   */
  status: access("healthcheck.status", "read", "View Health Check Status", {
    idParam: "systemId",
    isDefault: true,
    isPublic: true,
  }),

  /**
   * Bulk status access for viewing health check status for multiple systems.
   * Uses recordKey for filtering the output record by accessible system IDs.
   */
  bulkStatus: access("healthcheck.status", "read", "View Health Check Status", {
    recordKey: "statuses",
    isDefault: true,
    isPublic: true,
  }),

  /**
   * Configuration access for viewing and managing health check configurations.
   */
  configuration: accessPair("healthcheck", {
    read: "Read Health Check Configurations",
    manage: "Full management of Health Check Configurations",
  }),

  /**
   * Access for viewing detailed health check run data including metadata.
   * Allows access to extended visualizations without full management access.
   */
  details: access(
    "healthcheck.details",
    "read",
    "View Detailed Health Check Run Data (Warning: This may expose sensitive data, depending on the health check strategy)"
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const healthCheckAccessRules = [
  healthCheckAccess.status,
  healthCheckAccess.configuration.read,
  healthCheckAccess.configuration.manage,
  healthCheckAccess.details,
];
