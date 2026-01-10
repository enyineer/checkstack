import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { GrpcHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { HealthCollector } from "./health-collector";

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
        logger.debug("🔌 Registering gRPC Health Check Strategy...");
        const strategy = new GrpcHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new HealthCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
