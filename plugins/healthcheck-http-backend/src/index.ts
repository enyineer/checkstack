import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { HttpHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        healthCheckRegistry: coreServices.healthCheckRegistry,
        logger: coreServices.logger,
      },
      init: async ({ healthCheckRegistry, logger }) => {
        logger.debug("🔌 Registering HTTP Health Check Strategy...");
        const strategy = new HttpHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
      },
    });
  },
});
