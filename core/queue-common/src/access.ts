import { accessPair } from "@checkstack/common";

/**
 * Access rules for the Queue plugin.
 */
export const queueAccess = {
  /**
   * Queue settings access.
   */
  settings: accessPair("queue", {
    read: { description: "Read Queue Settings" },
    manage: { description: "Update Queue Settings" },
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const queueAccessRules = [
  queueAccess.settings.read,
  queueAccess.settings.manage,
];
