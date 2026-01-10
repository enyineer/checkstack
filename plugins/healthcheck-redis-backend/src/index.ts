import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { RedisHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { CommandCollector } from "./command-collector";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        healthCheckRegistry: coreServices.healthCheckRegistry,
        collectorRegistry: coreServices.collectorRegistry,
        logger: coreServices.logger,
      },
      init: async ({ healthCheckRegistry, collectorRegistry, logger }) => {
        logger.debug("🔌 Registering Redis Health Check Strategy...");
        const strategy = new RedisHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new CommandCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
