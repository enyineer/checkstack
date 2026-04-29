import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { InMemoryCachePlugin } from "./plugin";
import { cacheMemoryAccessRules } from "@checkstack/cache-memory-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(cacheMemoryAccessRules);

    env.registerInit({
      deps: {
        cachePluginRegistry: coreServices.cachePluginRegistry,
        logger: coreServices.logger,
      },
      init: async ({ cachePluginRegistry, logger }) => {
        logger.debug("🔌 Registering In-Memory Cache Plugin...");
        const plugin = new InMemoryCachePlugin();
        cachePluginRegistry.register(plugin);
      },
    });
  },
});
