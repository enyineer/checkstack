import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Automation plugin.
 */
export const automationAccess = {
  /**
   * Read access to automations and run history. Required to list automations
   * and inspect past runs.
   */
  read: access(
    "automation",
    "read",
    "View automations and run history",
    { pluginId: pluginMetadata.pluginId },
  ),
  /**
   * Manage automations: create, edit, enable/disable, delete, manually run.
   */
  manage: access(
    "automation",
    "manage",
    "Create, edit, enable, disable, delete, and manually run automations",
    { pluginId: pluginMetadata.pluginId },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const automationAccessRules = [
  automationAccess.read,
  automationAccess.manage,
];
