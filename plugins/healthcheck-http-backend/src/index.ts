import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { HttpHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { RequestCollector } from "./request-collector";

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
        logger.debug("🔌 Registering HTTP Health Check Strategy...");
        const strategy = new HttpHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new RequestCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
