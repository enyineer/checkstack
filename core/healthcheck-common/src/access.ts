import { access, accessPair, resourceType } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the health check plugin's resources.
 * Reference these (never a raw string) at capability call sites so a typo fails
 * typecheck.
 *
 * IMPORTANT: the configuration resource's team grants are keyed on
 * `"healthcheck.healthcheck"`, NOT `"healthcheck.configuration"`. The keying is
 * derived by the RPC middleware from the ACCESS RULE's `resource`
 * (`qualifyResourceType(pluginId, rule.resource)`), and the configuration rule is
 * declared as `accessPair("healthcheck", ...)` below (resource `"healthcheck"`),
 * so the qualified grant type is `healthcheck.healthcheck`. This constant MUST
 * match that key, or the frontend capability gate (`useCanAccessType` /
 * `manageCapability`) and the Teams grant-name resolver would look up a type the
 * backend never writes, and a team-scoped health-check manager would silently see
 * no management surface. Do NOT "tidy" this to `"configuration"` without a
 * migration that renames the stored `healthcheck.healthcheck.*` rule ids AND
 * re-keys existing grants. See `.claude/rules/rlac.md`.
 */
export const healthCheckResourceTypes = {
  configuration: resourceType(pluginMetadata, "healthcheck"),
};

/**
 * Access rules for the Health Check plugin.
 */
export const healthCheckAccess = {
  /**
   * Status-only access for viewing health check status.
   * Enabled by default for anonymous and authenticated users.
   * Uses system-level instance access for team-based filtering.
   *
   * Bulk endpoints should use the same access rule with instanceAccess
   * override at the contract level.
   */
  status: access("healthcheck.status", "read", "View Health Check Status", {
    isDefault: true,
    isPublic: true,
    pluginId: pluginMetadata.pluginId,
  }),

  /**
   * Configuration access for viewing and managing health check configurations.
   */
  configuration: accessPair(
    "healthcheck",
    {
      read: { description: "Read Health Check Configurations" },
      manage: { description: "Full management of Health Check Configurations" },
    },
    { pluginId: pluginMetadata.pluginId },
  ),

  /**
   * Access for viewing detailed health check run data including metadata.
   * Allows access to extended visualizations without full management access.
   */
  details: access(
    "healthcheck.details",
    "read",
    "View Detailed Health Check Run Data (Warning: This may expose sensitive data, depending on the health check strategy)",
    { pluginId: pluginMetadata.pluginId },
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
