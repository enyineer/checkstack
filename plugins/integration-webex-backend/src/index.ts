import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { providerExtensionPoint } from "@checkstack/integration-backend";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import { pluginMetadata } from "./plugin-metadata";
import { webexProvider } from "./provider";
import {
  createWebexActions,
  webexAccessRules,
  webexMessageArtifactType,
} from "./automations";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // A runAs service account must hold this rule to post Webex messages.
    env.registerAccessRules(webexAccessRules);
    env
      .getExtensionPoint(providerExtensionPoint)
      .addProvider(webexProvider, pluginMetadata);
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(webexMessageArtifactType, pluginMetadata);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        const actions = env.getExtensionPoint(automationActionExtensionPoint);
        for (const action of createWebexActions()) {
          actions.registerAction(action, pluginMetadata);
        }
        logger.debug("✅ Webex automation actions registered");
      },
    });
  },
});
