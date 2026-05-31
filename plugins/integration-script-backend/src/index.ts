import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
} from "@checkstack/automation-backend";
import {
  resolveResolutionRoot,
  resolveScriptPackagesDir,
} from "@checkstack/script-packages-backend";
import { ScriptPackagesApi } from "@checkstack/script-packages-common";
import { pluginMetadata } from "./plugin-metadata";
import {
  createScriptRunAction,
  scriptResultArtifactType,
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
    // Shell scripts run via `sh -c` and don't resolve npm modules, so the
    // shell action needs no resolution root.
    env
      .getExtensionPoint(automationActionExtensionPoint)
      .registerAction(shellRunAction, pluginMetadata);

    // The TS `run_script` action resolves the managed npm-package tree at
    // run time. The desired hash comes from script-packages over RPC; the
    // local `<store>/current` path check decides ready / notReady. Built in
    // init so `rpcClient` is available.
    env.registerInit({
      deps: {
        rpcClient: coreServices.rpcClient,
      },
      init: async ({ rpcClient }) => {
        const scriptRunAction = createScriptRunAction({
          getResolutionRoot: async () => {
            const state = await rpcClient
              .forPlugin(ScriptPackagesApi)
              .getInstallState();
            return resolveResolutionRoot({
              desiredLockfileHash: state.lockfileHash,
              storeRoot: resolveScriptPackagesDir(),
              hostLabel: "central backend",
            });
          },
        });
        env
          .getExtensionPoint(automationActionExtensionPoint)
          .registerAction(scriptRunAction, pluginMetadata);
      },
    });
  },
});
