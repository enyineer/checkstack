import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { HttpHealthCheckStrategy } from "./strategy";

export default createBackendPlugin({
  pluginId: "http-healthcheck-backend",
  register(env) {
    env.registerInit({
      deps: {
        healthCheckRegistry: coreServices.healthCheckRegistry,
        logger: coreServices.logger,
      },
      init: async ({ healthCheckRegistry, logger }) => {
        logger.info("🔌 Registering HTTP Health Check Strategy...");
        const strategy = new HttpHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
      },
    });
  },
});
