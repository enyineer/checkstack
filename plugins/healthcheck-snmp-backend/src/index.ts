import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { SnmpHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { SnmpCollector } from "./snmp-collector";

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
        logger.debug("🔌 Registering SNMP Health Check Strategy...");
        const strategy = new SnmpHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new SnmpCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
