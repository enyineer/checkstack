import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { SshHealthCheckStrategy } from "./strategy";
import { CommandCollector } from "./command-collector";
import { pluginMetadata } from "./plugin-metadata";

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
        logger.debug("🔌 Registering SSH Health Check Strategy...");
        const strategy = new SshHealthCheckStrategy();
        healthCheckRegistry.register(strategy);

        // Register the built-in command collector (allows "basic mode" via collector UI)
        collectorRegistry.register(new CommandCollector());
        logger.debug("   -> Registered __command__ collector");
      },
    });
  },
});
