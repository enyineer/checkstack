import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { RconHealthCheckStrategy } from "./strategy";
import { CommandCollector } from "./command-collector";
import { pluginMetadata } from "./plugin-metadata";
import {
  MinecraftPlayersCollector,
  MinecraftServerCollector,
  SourceStatusCollector,
  SourcePlayersCollector,
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
        logger.debug("🔌 Registering RCON Health Check Strategy...");

        // Register the transport strategy
        const strategy = new RconHealthCheckStrategy();
        healthCheckRegistry.register(strategy);

        // Register the generic command collector
        collectorRegistry.register(new CommandCollector());

        // Register game-specific collectors
        collectorRegistry.register(new MinecraftPlayersCollector());
        collectorRegistry.register(new MinecraftServerCollector());
        collectorRegistry.register(new SourceStatusCollector());
        collectorRegistry.register(new SourcePlayersCollector());

        logger.info(
          "✅ RCON health check registered (strategy + 5 collectors)"
        );
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
