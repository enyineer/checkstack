import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { JenkinsHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import {
  ServerInfoCollector,
  JobStatusCollector,
  BuildHistoryCollector,
  QueueInfoCollector,
  NodeHealthCollector,
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
        logger.debug("🔌 Registering Jenkins Health Check Strategy...");

        // Register the transport strategy
        const strategy = new JenkinsHealthCheckStrategy();
        healthCheckRegistry.register(strategy);

        // Register all collectors
        collectorRegistry.register(new ServerInfoCollector());
        collectorRegistry.register(new JobStatusCollector());
        collectorRegistry.register(new BuildHistoryCollector());
        collectorRegistry.register(new QueueInfoCollector());
        collectorRegistry.register(new NodeHealthCollector());

        logger.info(
          "✅ Jenkins health check registered (strategy + 5 collectors)",
        );
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
