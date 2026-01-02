import { createPermission } from "@checkmate/common";

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
  healthCheckManage: createPermission(
    "healthcheck",
    "manage",
    "Full management of Health Check Configurations"
  ),
};

export const permissionList = Object.values(permissions);
