import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Plugin Manager.
 *
 * The plugin system runs arbitrary code with full platform access — only
 * trusted operators should hold the `manage` rule, which covers both
 * installing and uninstalling plugins.
 */
export const pluginManagerAccess = {
  view: access("plugin", "read", "View installed plugins and install events", {
    pluginId: pluginMetadata.pluginId,
  }),
  manage: access("plugin", "manage", "Install and uninstall plugins", {
    pluginId: pluginMetadata.pluginId,
  }),
};

export const pluginManagerAccessRules = [
  pluginManagerAccess.view,
  pluginManagerAccess.manage,
];
