import { accessPair, resourceType } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the SLO plugin's resources.
 * Reference these (never a raw `"slo.slo"` string) at capability call sites so
 * a typo fails typecheck.
 */
export const sloResourceTypes = {
  slo: resourceType(pluginMetadata, "slo"),
};

/**
 * Access rules for the SLO plugin.
 */
export const sloAccess = {
  /**
   * SLO access with both read and manage levels.
   * Read is public by default (anyone can view SLO status).
   * Manage requires authentication (create, edit, delete SLOs).
   */
  slo: accessPair(
    "slo",
    {
      read: {
        description: "View SLOs and error budgets",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description: "Create, edit, and delete SLOs",
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
export const sloAccessRules = [sloAccess.slo.read, sloAccess.slo.manage];
