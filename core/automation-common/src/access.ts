import { access, resourceType } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the automation plugin's resources.
 * Reference these (never a raw `"automation.automation"` string) at capability
 * call sites so a typo fails typecheck.
 */
export const automationResourceTypes = {
  automation: resourceType(pluginMetadata, "automation"),
};

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
