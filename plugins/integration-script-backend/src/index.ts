import { createBackendPlugin } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import { pluginMetadata } from "./plugin-metadata";
import {
  scriptResultArtifactType,
  scriptRunAction,
  shellResultArtifactType,
  shellRunAction,
} from "./automations";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(shellResultArtifactType, pluginMetadata);
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(scriptResultArtifactType, pluginMetadata);
    env
      .getExtensionPoint(automationActionExtensionPoint)
      .registerAction(shellRunAction, pluginMetadata);
    env
      .getExtensionPoint(automationActionExtensionPoint)
      .registerAction(scriptRunAction, pluginMetadata);
  },
});
