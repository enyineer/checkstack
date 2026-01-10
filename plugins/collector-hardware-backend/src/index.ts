import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { CpuCollector, MemoryCollector, DiskCollector } from "./collectors";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        collectorRegistry: coreServices.collectorRegistry,
        logger: coreServices.logger,
      },
      init: async ({ collectorRegistry, logger }) => {
        logger.debug("🔌 Registering hardware collectors...");

        // Register all hardware collectors
        // Owner plugin metadata is auto-injected via scoped factory
        collectorRegistry.register(new CpuCollector());
        collectorRegistry.register(new MemoryCollector());
        collectorRegistry.register(new DiskCollector());

        logger.info("✅ Hardware collectors registered (CPU, Memory, Disk)");
      },
    });
  },
});
