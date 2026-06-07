import { accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the In-Memory Cache plugin.
 */
export const cacheMemoryAccess = accessPair(
  "cache-memory",
  {
    read: { description: "View in-memory cache configuration and statistics" },
    manage: { description: "Modify in-memory cache configuration" },
  },
  // Must match the backend plugin id (cache-memory-backend) that registers these.
  { pluginId: "cache-memory" },
);

/**
 * All access rules for registration with the plugin system.
 */
export const cacheMemoryAccessRules: AccessRule[] = [
  cacheMemoryAccess.read,
  cacheMemoryAccess.manage,
];
