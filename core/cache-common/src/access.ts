import { accessPair } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the Cache plugin.
 */
export const cacheAccess = {
  /**
   * Cache settings access.
   */
  settings: accessPair(
    "cache",
    {
      read: { description: "Read Cache Settings" },
      manage: { description: "Update Cache Settings" },
    },
    {
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const cacheAccessRules = [
  cacheAccess.settings.read,
  cacheAccess.settings.manage,
];
