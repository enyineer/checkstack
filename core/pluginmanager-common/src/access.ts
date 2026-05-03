import { access } from "@checkstack/common";

/**
 * Access rules for the Plugin Manager.
 *
 * The plugin system runs arbitrary code with full platform access — only
 * trusted operators should hold the `manage` rule.
 */
export const pluginManagerAccess = {
  view: access("plugin", "read", "View installed plugins and install events"),
  install: access("plugin", "manage", "Install plugins from any source"),
  uninstall: access("plugin", "manage", "Uninstall plugins"),
};

export const pluginManagerAccessRules = [
  pluginManagerAccess.view,
  pluginManagerAccess.install,
  pluginManagerAccess.uninstall,
];
