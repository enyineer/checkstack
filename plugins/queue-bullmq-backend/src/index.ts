import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { BullMQPlugin } from "./plugin";
import { permissionList } from "@checkmate-monitor/queue-bullmq-common";
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
        logger.debug("🔌 Registering BullMQ Queue Plugin...");
        const plugin = new BullMQPlugin();
        queuePluginRegistry.register(plugin);
      },
    });
  },
});
