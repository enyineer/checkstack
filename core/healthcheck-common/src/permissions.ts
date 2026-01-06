import { createPermission } from "@checkmate-monitor/common";

export const permissions = {
  /**
   * Status-only permission for viewing health check status.
   * Enabled by default for anonymous and authenticated users.
   */
  healthCheckStatusRead: createPermission(
    "healthcheck.status",
    "read",
    "View Health Check Status",
    { isAuthenticatedDefault: true, isPublicDefault: true }
  ),
  /**
   * Configuration read permission for viewing health check configurations.
   * Restricted to users with explicit grant.
   */
  healthCheckRead: createPermission(
    "healthcheck",
    "read",
    "Read Health Check Configurations"
  ),
  /**
   * Permission for viewing detailed health check run data including metadata.
   * Allows access to extended visualizations without full management access.
   */
  healthCheckDetailsRead: createPermission(
    "healthcheck.details",
    "read",
    "View Detailed Health Check Run Data (Warning: This may expose sensitive data, depending on the health check strategy)"
  ),
  healthCheckManage: createPermission(
    "healthcheck",
    "manage",
    "Full management of Health Check Configurations"
  ),
};

export const permissionList = Object.values(permissions);
