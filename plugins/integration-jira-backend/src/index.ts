import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import {
  integrationProviderExtensionPoint,
  connectionStoreRef,
} from "@checkmate-monitor/integration-backend";
import { pluginMetadata } from "@checkmate-monitor/integration-jira-common";
import { createJiraProvider } from "./provider";

export const jiraPlugin = createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register the Jira provider
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        connectionStore: connectionStoreRef,
      },
      init: async ({ logger, connectionStore }) => {
        logger.debug("🔌 Registering Jira Integration Provider...");

        // Create and register the Jira provider
        // Uses generic connection management via connectionStore
        const jiraProvider = createJiraProvider({ connectionStore });
        const integrationExt = env.getExtensionPoint(
          integrationProviderExtensionPoint
        );
        integrationExt.addProvider(jiraProvider, pluginMetadata);

        logger.info("✅ Jira Integration Plugin registered");
      },
    });
  },
});

export default jiraPlugin;
