import { createBackendPlugin } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import { pluginMetadata } from "./plugin-metadata";
import {
  webhookDeliveryArtifactType,
  webhookSendAction,
} from "./automations";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(webhookDeliveryArtifactType, pluginMetadata);
    env
      .getExtensionPoint(automationActionExtensionPoint)
      .registerAction(webhookSendAction, pluginMetadata);
  },
});
