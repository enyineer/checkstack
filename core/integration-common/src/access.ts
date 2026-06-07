import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Integration plugin.
 */
export const integrationAccess = {
  /**
   * Manage webhook integrations and view delivery logs.
   */
  manage: access(
    "integration",
    "manage",
    "Manage webhook integrations and view delivery logs",
    {
      pluginId: pluginMetadata.pluginId,
    }
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const integrationAccessRules = [integrationAccess.manage];
