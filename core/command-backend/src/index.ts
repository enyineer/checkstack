import {
  createBackendPlugin,
  coreServices,
  coreHooks,
} from "@checkmate-monitor/backend-api";
import {
  pluginMetadata,
  commandContract,
} from "@checkmate-monitor/command-common";
import { createCommandRouter } from "./router";
import { unregisterProvidersByPluginId } from "./registry";

// Re-export registry functions for other plugins to use
export {
  registerSearchProvider,
  unregisterSearchProvider,
  clearRegistry,
  type BackendSearchProvider,
  type SearchContext,
  type CommandDefinition,
  type RegisterSearchProviderOptions,
} from "./registry";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ rpc, logger }) => {
        logger.debug("Initializing Command Backend...");

        // Register oRPC router
        const commandRouter = createCommandRouter();
        rpc.registerRouter(commandRouter, commandContract);

        logger.debug("✅ Command Backend initialized.");
      },
      afterPluginsReady: async ({ logger, onHook }) => {
        // Subscribe to plugin deregistration to clean up their commands
        onHook(
          coreHooks.pluginDeregistering,
          async ({ pluginId }) => {
            const removed = unregisterProvidersByPluginId(pluginId);
            if (removed > 0) {
              logger.debug(
                `[command-backend] Unregistered ${removed} search provider(s) for plugin: ${pluginId}`
              );
            }
          },
          { mode: "instance-local" }
        );
      },
    });
  },
});
