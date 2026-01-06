import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { InMemoryQueuePlugin } from "./plugin";
import { permissionList } from "@checkmate-monitor/queue-memory-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
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
