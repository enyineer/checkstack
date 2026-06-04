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
        // The GLOBAL sandbox policy is owned by `script-packages` (the single
        // source of truth). It registers the one process-wide policy provider
        // that every script runner on this pod resolves through, so this plugin
        // does NOT register a competing provider (the old per-plugin
        // registration read a DIFFERENT plugin-scoped row → last-writer-wins).
        //
        // The one-time startup capability/readiness log is emitted IN PROCESS
        // by `script-packages` itself (the single policy owner), so this plugin
        // no longer makes a `getSandboxPolicy` RPC at init — that self-loop POST
        // 404'd whenever this plugin initialised before `script-packages`
        // mounted its router. The runner's enforcement path is unchanged: it
        // resolves the active policy through `script-packages`' provider.
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
