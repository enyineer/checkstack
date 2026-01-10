import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { PostgresHealthCheckStrategy } from "./strategy";
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
        logger.debug("🔌 Registering PostgreSQL Health Check Strategy...");
        const strategy = new PostgresHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new QueryCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
