import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { DnsHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { LookupCollector } from "./lookup-collector";

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
        logger.debug("🔌 Registering DNS Health Check Strategy...");
        const strategy = new DnsHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new LookupCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
