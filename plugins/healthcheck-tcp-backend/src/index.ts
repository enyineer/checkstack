import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { TcpHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { BannerCollector } from "./banner-collector";

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
        logger.debug("🔌 Registering TCP Health Check Strategy...");
        const strategy = new TcpHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new BannerCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
