import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { providerExtensionPoint } from "@checkstack/integration-backend";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import { pluginMetadata } from "./plugin-metadata";
import { teamsProvider } from "./provider";
import {
  createTeamsActions,
  teamsAccessRules,
  teamsMessageArtifactType,
} from "./automations";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // A runAs service account must hold this rule to post Teams messages.
    env.registerAccessRules(teamsAccessRules);
    env
      .getExtensionPoint(providerExtensionPoint)
      .addProvider(teamsProvider, pluginMetadata);
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(teamsMessageArtifactType, pluginMetadata);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        const actions = env.getExtensionPoint(automationActionExtensionPoint);
        for (const action of createTeamsActions()) {
          actions.registerAction(action, pluginMetadata);
        }
        logger.debug("✅ Teams automation actions registered");
      },
    });
  },
});
