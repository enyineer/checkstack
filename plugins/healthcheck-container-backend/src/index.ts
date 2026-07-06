import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { ContainerHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import {
  ContainerStatusCollector,
  ContainerStatsCollector,
} from "./collectors";

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
        logger.debug("🔌 Registering Container Health Check Strategy...");
        healthCheckRegistry.register(new ContainerHealthCheckStrategy());
        collectorRegistry.register(new ContainerStatusCollector());
        collectorRegistry.register(new ContainerStatsCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
