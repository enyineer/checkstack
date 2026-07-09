import { accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the Redis Cache plugin.
 */
export const cacheRedisAccess = accessPair(
  "cache-redis",
  {
    read: { description: "View Redis cache configuration and statistics" },
    manage: { description: "Modify Redis cache configuration" },
  },
  // Must match the backend plugin id (cache-redis-backend) that registers these.
  { pluginId: "cache-redis" },
);

/**
 * All access rules for registration with the plugin system.
 */
export const cacheRedisAccessRules: AccessRule[] = [
  cacheRedisAccess.read,
  cacheRedisAccess.manage,
];
