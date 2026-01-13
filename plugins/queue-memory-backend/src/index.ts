import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { InMemoryQueuePlugin } from "./plugin";
import { queueMemoryAccessRules } from "@checkstack/queue-memory-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(queueMemoryAccessRules);

    env.registerInit({
      deps: {
        queuePluginRegistry: coreServices.queuePluginRegistry,
        logger: coreServices.logger,
      },
      init: async ({ queuePluginRegistry, logger }) => {
        logger.debug("🔌 Registering In-Memory Queue Plugin...");
        const plugin = new InMemoryQueuePlugin();
        queuePluginRegistry.register(plugin);
      },
    });
  },
});
