import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { InMemoryQueuePlugin } from "./plugin";
import { permissionList } from "@checkmate/queue-memory-common";

export default createBackendPlugin({
  pluginId: "queue-memory-backend",
  register(env) {
    env.registerPermissions(permissionList);

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
