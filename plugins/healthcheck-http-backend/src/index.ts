import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { HttpHealthCheckStrategy } from "./strategy";

export default createBackendPlugin({
  pluginId: "healthcheck-http-backend",
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
