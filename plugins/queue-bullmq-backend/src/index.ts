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
        instanceRuntime: coreServices.instanceRuntime,
        logger: coreServices.logger,
      },
      init: async ({ queuePluginRegistry, instanceRuntime, logger }) => {
        logger.debug("🔌 Registering BullMQ Queue Plugin...");
        // Fold the instance namespace into every queue's redis key prefix so a
        // secondary instance (e.g. the PR-preview instance) sharing the same
        // redis cannot collide with the default instance's queue state.
        const plugin = new BullMQPlugin({
          namespace: instanceRuntime.namespace,
        });
        queuePluginRegistry.register(plugin);
      },
    });
  },
});
