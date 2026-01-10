import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { PingHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { PingCollector } from "./ping-collector";

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
        logger.debug("🔌 Registering Ping Health Check Strategy...");
        const strategy = new PingHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new PingCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
