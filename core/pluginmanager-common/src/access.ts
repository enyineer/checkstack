import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Plugin Manager.
 *
 * The plugin system runs arbitrary code with full platform access — only
 * trusted operators should hold the `manage` rule.
 */
export const pluginManagerAccess = {
  view: access("plugin", "read", "View installed plugins and install events", {
    pluginId: pluginMetadata.pluginId,
  }),
  install: access("plugin", "manage", "Install plugins from any source", {
    pluginId: pluginMetadata.pluginId,
  }),
  uninstall: access("plugin", "manage", "Uninstall plugins", {
    pluginId: pluginMetadata.pluginId,
  }),
};

export const pluginManagerAccessRules = [
  pluginManagerAccess.view,
  pluginManagerAccess.install,
  pluginManagerAccess.uninstall,
];
