import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { TlsHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { CertificateCollector } from "./certificate-collector";

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
        logger.debug("🔌 Registering TLS/SSL Health Check Strategy...");
        const strategy = new TlsHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new CertificateCollector());
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
