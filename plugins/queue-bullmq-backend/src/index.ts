import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { BullMQPlugin } from "./plugin";
import { queueBullmqAccessRules } from "@checkstack/queue-bullmq-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(queueBullmqAccessRules);

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
