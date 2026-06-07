import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationProviderExtensionPoint } from "@checkstack/integration-backend";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import { pluginMetadata } from "@checkstack/integration-jira-common";
import { createJiraProvider } from "./provider";
import {
  createJiraActions,
  jiraIssueArtifactType,
  jiraIssueSearchArtifactType,
} from "./automations";

export const jiraPlugin = createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register the jira.issue artifact type early so downstream
    // plugins / the editor can see it. Safe in `register()` since the
    // extension point is buffered.
    const artifactTypes = env.getExtensionPoint(
      automationArtifactTypeExtensionPoint,
    );
    artifactTypes.registerArtifactType(jiraIssueArtifactType, pluginMetadata);
    artifactTypes.registerArtifactType(
      jiraIssueSearchArtifactType,
      pluginMetadata,
    );

    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        logger.debug("🔌 Registering Jira Integration Provider...");

        // Legacy integration provider (still wired for the existing
        // subscription-based delivery path until Phase 6/8).
        const jiraProvider = createJiraProvider();
        const integrationExt = env.getExtensionPoint(
          integrationProviderExtensionPoint,
        );
        integrationExt.addProvider(jiraProvider, pluginMetadata);

        // Actions fetch the connection store lazily inside `execute`
        // via `getService(connectionStoreRef)`. Doing it at execute
        // time (rather than baking it in as an init-time closure
        // dependency) lets this plugin's init run without consuming
        // `connectionStoreRef` — important because integration-backend
        // registers that service inside its own `init()`, so the
        // topological sort can't statically order this plugin's init
        // after that.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createJiraActions()) {
          automationActions.registerAction(action, pluginMetadata);
        }

        logger.info("✅ Jira Integration Plugin registered");
      },
    });
  },
});

export default jiraPlugin;
