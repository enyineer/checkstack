import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  resolveResolutionRootFromStore,
  resolveScriptPackagesDir,
} from "@checkstack/script-packages-backend";
import { ScriptHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { ExecuteCollector } from "./execute-collector";
import {
  InlineScriptCollector,
  defaultInlineScriptExecutor,
} from "./inline-script-collector";

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
        // The inline TS collector resolves the managed npm-package tree from
        // the local store - identical on core and satellites (same
        // `<dataDir>/script-packages/current` convention). No RPC needed, so
        // it works in the satellite runtime too. Execution safety is
        // guaranteed by the runner (auto-install disabled); this just points
        // it at the synced tree when present.
        collectorRegistry.register(
          new InlineScriptCollector(defaultInlineScriptExecutor, () =>
            resolveResolutionRootFromStore(resolveScriptPackagesDir()),
          ),
        );
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
