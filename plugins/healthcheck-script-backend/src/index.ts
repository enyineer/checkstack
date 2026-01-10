import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { ScriptHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { ExecuteCollector } from "./execute-collector";

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
        logger.debug("🔌 Registering Script Health Check Strategy...");
        const strategy = new ScriptHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new ExecuteCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
