import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  resolveResolutionRootFromStore,
  resolveScriptPackagesDir,
} from "@checkstack/script-packages-backend";
import { ScriptHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";
import { ExecuteCollector } from "./execute-collector";
import {
  InlineScriptCollector,
  defaultInlineScriptExecutor,
} from "./inline-script-collector";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        healthCheckRegistry: coreServices.healthCheckRegistry,
        collectorRegistry: coreServices.collectorRegistry,
        logger: coreServices.logger,
      },
      init: async ({ healthCheckRegistry, collectorRegistry, logger }) => {
        logger.debug("🔌 Registering Script Health Check Strategy...");
        // The GLOBAL sandbox policy is owned by `script-packages` (the single
        // source of truth). On the CORE pod it registers the one process-wide
        // policy provider every runner resolves through, so this plugin does
        // NOT register a competing provider (the old per-plugin registration
        // read a DIFFERENT plugin-scoped row → last-writer-wins). On the
        // SATELLITE runtime the satellite registers its own RELAY-backed
        // provider at startup (see `core/satellite/src/index.ts`), which fails
        // closed until the first policy relay arrives.
        //
        // The one-time startup capability/readiness log is emitted IN PROCESS
        // by `script-packages` itself (the single policy owner), so this plugin
        // no longer makes a `getSandboxPolicy` RPC at init — that self-loop POST
        // 404'd whenever this plugin initialised before `script-packages`
        // mounted its router. The runner's enforcement path is unchanged: it
        // resolves the active policy through `script-packages`' provider.
        const strategy = new ScriptHealthCheckStrategy();
        healthCheckRegistry.register(strategy);
        collectorRegistry.register(new ExecuteCollector());
        // The inline TS collector resolves the managed npm-package tree from
        // the local store - identical on core and satellites (same
        // `<dataDir>/script-packages/current` convention). No RPC needed, so
        // it works in the satellite runtime too. Execution safety is
        // guaranteed by the runner (auto-install disabled); this just points
        // it at the synced tree when present.
        collectorRegistry.register(
          new InlineScriptCollector(
            defaultInlineScriptExecutor,
            () => resolveResolutionRootFromStore(resolveScriptPackagesDir()),
          ),
        );
      },
    });
  },
});

export { pluginMetadata } from "./plugin-metadata";
