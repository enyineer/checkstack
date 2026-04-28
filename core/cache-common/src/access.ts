import { accessPair } from "@checkstack/common";

/**
 * Access rules for the Cache plugin.
 */
export const cacheAccess = {
  /**
   * Cache settings access.
   */
  settings: accessPair("cache", {
    read: { description: "Read Cache Settings" },
    manage: { description: "Update Cache Settings" },
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const cacheAccessRules = [
  cacheAccess.settings.read,
  cacheAccess.settings.manage,
];
