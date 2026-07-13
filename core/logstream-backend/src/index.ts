import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import {
  pluginMetadata,
  logstreamAccessRules,
} from "@checkstack/logstream-common";
import * as schema from "./schema";
import { createStorage } from "./storage";
import { createImportantEventRecorder } from "./events/recorder";
import { createDrainEngine } from "./drain/engine";
import { registerHealthIntegration } from "./health/setup";
import { registerIngestEndpoints } from "./ingest/setup";
import { getIngestCounters } from "./ingest";
import { registerApi } from "./api/setup";

/**
 * Log stream backend plugin. Thin orchestration: it builds the shared storage,
 * recorder and Drain engine, then hands each area its setup function (ingest /
 * health / api). Those setup functions are the seams the Wave-2 agents
 * implement; Phase 1 ships them as compiling no-ops.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerAccessRules(logstreamAccessRules);

    // Bridges init() -> afterPluginsReady(): maintenance scheduling must wait
    // until every plugin's router is registered, because the retention pass
    // resolves healthcheck-referenced patterns over cross-plugin RPC (an
    // overdue job firing mid-boot would 404 and skip its sweep). Repo
    // precedent: notification-backend's module-scoped holder.
    let startMaintenance: (() => Promise<void>) | null = null;

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        signalService: coreServices.signalService,
        cacheManager: coreServices.cacheManager,
        queueManager: coreServices.queueManager,
        rpcClient: coreServices.rpcClient,
        eventBus: coreServices.eventBus,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        collectorRegistry: coreServices.collectorRegistry,
        instanceRuntime: coreServices.instanceRuntime,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
      },
      init: async ({
        database,
        rpc,
        logger,
        signalService,
        cacheManager,
        queueManager,
        rpcClient,
        eventBus,
        healthCheckRegistry,
        collectorRegistry,
        instanceRuntime,
        resourceResolverRegistry,
      }) => {
        // The runtime injects the plugin's schema-scoped db typed as
        // `SafeDatabase<Record<string, unknown>>`; narrow it to this plugin's
        // schema. Established repo pattern (see e.g. announcement-backend).
        const db = database as SafeDatabase<typeof schema>;

        const storage = createStorage({ db });
        const recorder = createImportantEventRecorder({
          db,
          signalService,
          logger,
        });
        const drain = createDrainEngine({
          storage,
          cacheManager,
          instanceRuntime,
          logger,
        });

        const health = registerHealthIntegration({
          rpc,
          db,
          storage,
          recorder,
          queueManager,
          rpcClient,
          cacheManager,
          signalService,
          logger,
          instanceRuntime,
          healthCheckRegistry,
          collectorRegistry,
        });

        const ingest = registerIngestEndpoints({
          rpc,
          db,
          storage,
          drain,
          recorder,
          cacheManager,
          signalService,
          logger,
          instanceRuntime,
          eventBus,
          onIngestFlush: health.onIngestFlush,
          // Healthcheck-referenced pattern ids feed the Drain protected set so
          // a pattern a check asserts on is never evicted/re-mined under a
          // fresh id (and retention never deletes it).
          getReferencedPatternIds: health.getReferencedPatternIds,
        });
        // Final flush + listener teardown on plugin deregister/shutdown so the
        // last buffered lines are not dropped (stop() is idempotent).
        env.registerCleanup(ingest.stop);

        // Contribute the "logstream" satellite telemetry handler so logs a
        // satellite forwards over the WS channel reach the same auth + pipeline
        // as the HTTP endpoints. satellite-backend owns the contract; we supply
        // the implementation (dependency inversion - see dependencies.md).
        env
          .getExtensionPoint(satelliteCapabilityExtensionPoint)
          .registerCapability(ingest.satelliteCapabilityHandler, pluginMetadata);

        registerApi({
          rpc,
          db,
          storage,
          cacheManager,
          signalService,
          logger,
          resourceResolverRegistry,
          ingestCounters: getIngestCounters,
          rpcClient,
          eventBus,
        });

        startMaintenance = health.startMaintenance;

        logger.debug("✅ Logstream backend init complete.");
      },

      afterPluginsReady: async () => {
        // Phase 3: every plugin's router is now registered, so the retention
        // pass's cross-plugin reference resolution cannot 404.
        await startMaintenance?.();
      },
    });
  },
});
