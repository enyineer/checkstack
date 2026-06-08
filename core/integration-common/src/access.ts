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
  /**
   * Read integration connections (name-only summaries + dynamic field options)
   * for use when authoring automations - WITHOUT the admin-level `manage` rights
   * that expose config previews and CRUD. Gates `listConnectionSummaries` and
   * `resolveConnectionOptions`, so referencing a connection in an automation
   * action requires a deliberate grant rather than being open to any
   * authenticated user.
   */
  read: access(
    "integration",
    "read",
    "Read integration connections and field options when authoring automations",
    {
      pluginId: pluginMetadata.pluginId,
    }
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const integrationAccessRules = [
  integrationAccess.manage,
  integrationAccess.read,
];
