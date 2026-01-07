import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { integrationProviderExtensionPoint } from "@checkmate-monitor/integration-backend";
import { pluginMetadata } from "@checkmate-monitor/integration-jira-common";
import { createJiraProvider } from "./provider";

export const jiraPlugin = createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register the Jira provider
    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        logger.debug("🔌 Registering Jira Integration Provider...");

        // Create and register the Jira provider
        // No dependencies needed - connection access is provided through context/params
        const jiraProvider = createJiraProvider();
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
