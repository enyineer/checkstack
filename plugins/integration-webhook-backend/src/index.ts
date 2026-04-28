import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationProviderExtensionPoint } from "@checkstack/integration-backend";
import { pluginMetadata } from "./plugin-metadata";
import { webhookProvider } from "./provider";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        logger.debug("🔌 Registering Webhook Integration Provider...");

        // Get the integration provider extension point
        const extensionPoint = env.getExtensionPoint(
          integrationProviderExtensionPoint,
        );

        // Register the webhook provider
        extensionPoint.addProvider(webhookProvider, pluginMetadata);

        logger.debug("✅ Webhook Integration Provider registered.");
      },
    });
  },
});
