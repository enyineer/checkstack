import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { RedisCachePlugin } from "./plugin";
import { cacheRedisAccessRules } from "@checkstack/cache-redis-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(cacheRedisAccessRules);

    env.registerInit({
      deps: {
        cachePluginRegistry: coreServices.cachePluginRegistry,
        instanceRuntime: coreServices.instanceRuntime,
        logger: coreServices.logger,
      },
      init: async ({ cachePluginRegistry, instanceRuntime, logger }) => {
        logger.debug("🔌 Registering Redis Cache Plugin...");
        // Fold the instance namespace into every cache key so a secondary
        // instance (e.g. the PR-preview instance) sharing the same Redis cannot
        // collide with the default instance's cache — mirroring the BullMQ
        // queue backend's namespacing.
        const plugin = new RedisCachePlugin(instanceRuntime.namespace);
        cachePluginRegistry.register(plugin);
      },
    });
  },
});
