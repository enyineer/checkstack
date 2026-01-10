import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { MysqlHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { QueryCollector } from "./query-collector";

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
        logger.debug("🔌 Registering MySQL Health Check Strategy...");
        const strategy = new MysqlHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new QueryCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
