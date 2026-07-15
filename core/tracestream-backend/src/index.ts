import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import {
  tracestreamAccessRules,
  pluginMetadata,
} from "@checkstack/tracestream-common";
import { telemetrySinkExtensionPoint } from "@checkstack/telemetry-backend";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import { aiToolProjectionExtensionPoint } from "@checkstack/ai-backend";
import * as schema from "./schema";
import { registerTracestreamAiProjections } from "./api/ai-projections";
import { createStorage } from "./storage";
import { createImportantEventRecorder } from "./events/recorder";
import { registerMaintenance } from "./health/maintenance";
import { registerHealthIntegration } from "./health/setup";
import { registerIngest } from "./ingest/setup";
import { registerApi } from "./api/setup";
import { createTracestreamTelemetrySink } from "./telemetry-sink";

/**
 * Trace stream backend plugin. Thin orchestration (mirrors metricstream): it
 * builds the shared storage ports and the important-event recorder, then hands
 * each area its setup function - ingest, API and maintenance. Ingest and API are
 * COMPILING STUBS the later waves (tasks #21 / #22) fill IN PLACE; each is
 * handed the full dependency set here so those waves never edit this file.
 *
 * Maintenance (tail-sampling decision + rollup + sweep + cleanup) starts in
 * init: unlike metricstream it does NO cross-plugin RPC, so it does not need to
 * wait for `afterPluginsReady`.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerAccessRules(tracestreamAccessRules);

    // The traces SINK for the telemetry platform (registration is buffered
    // behind the extension point, so load order does not matter).
    const telemetrySink = env.getExtensionPoint(telemetrySinkExtensionPoint);

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        auth: coreServices.auth,
        signalService: coreServices.signalService,
        cacheManager: coreServices.cacheManager,
        queueManager: coreServices.queueManager,
        rpcClient: coreServices.rpcClient,
        eventBus: coreServices.eventBus,
        instanceRuntime: coreServices.instanceRuntime,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
        healthCheckRegistry: coreServices.healthCheckRegistry,
        collectorRegistry: coreServices.collectorRegistry,
      },
      init: async ({
        database,
        rpc,
        logger,
        auth,
        signalService,
        cacheManager,
        queueManager,
        rpcClient,
        eventBus,
        instanceRuntime,
        resourceResolverRegistry,
        healthCheckRegistry,
        collectorRegistry,
      }) => {
        // The runtime injects the plugin's schema-scoped db typed as
        // `SafeDatabase<Record<string, unknown>>`; narrow it to this plugin's
        // schema (established repo pattern).
        const db = database as SafeDatabase<typeof schema>;

        const storage = createStorage({ db });
        const recorder = createImportantEventRecorder({
          store: storage.importantEvents,
          signalService,
          logger,
        });

        // Health integration (strategy + collectors + fast-path) BEFORE ingest,
        // so the pipeline receives the fast-path hook to invoke post-commit.
        const health = registerHealthIntegration({
          storage,
          queueManager,
          cacheManager,
          logger,
          healthCheckRegistry,
          collectorRegistry,
          rpcClient,
        });

        const ingest = registerIngest({
          db,
          storage,
          recorder,
          rpc,
          cacheManager,
          signalService,
          queueManager,
          eventBus,
          instanceRuntime,
          logger,
          onIngestFlush: health.onIngestFlush,
        });
        // Final flush + timer teardown on deregister/shutdown (stop is idempotent).
        env.registerCleanup(ingest.stop);

        // Contribute the "tracestream" satellite telemetry handler so spans a
        // satellite forwards over the WS channel reach the same auth + pipeline
        // as the HTTP endpoints. satellite-backend owns the contract; we supply
        // the implementation (dependency inversion - see dependencies.md).
        env
          .getExtensionPoint(satelliteCapabilityExtensionPoint)
          .registerCapability(ingest.satelliteCapabilityHandler, pluginMetadata);

        telemetrySink.registerSink(
          createTracestreamTelemetrySink({
            resolveStream: async (id) => {
              const stream = await storage.streams.get({ id });
              return stream ? { id: stream.id, name: stream.name } : null;
            },
            // Batched name resolution for the Sources page (streams are few;
            // one picker query beats N point lookups).
            resolveStreams: async (streamIds) => {
              const all = await storage.streams.listForPicker();
              const byId = new Map(all.map((s) => [s.id, s]));
              return Object.fromEntries(
                streamIds.map((id) => [id, byId.get(id) ?? null]),
              );
            },
            listStreams: () => storage.streams.listForPicker(),
            pipeline: ingest.pipeline,
            configResolver: ingest.configResolver,
            auth,
            logger,
          }),
          pluginMetadata,
        );

        registerApi({
          db,
          storage,
          rpc,
          rpcClient,
          cacheManager,
          signalService,
          resourceResolverRegistry,
          eventBus,
          logger,
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
        });

        // Expose read procedures as model-facing AI tools (owned here, not in
        // ai-backend). Registration is buffered behind the extension point, so
        // load order relative to ai-backend does not matter.
        registerTracestreamAiProjections(
          env.getExtensionPoint(aiToolProjectionExtensionPoint),
        );

        const maintenance = registerMaintenance({
          queueManager,
          storage,
          recorder,
          logger,
        });
        env.registerCleanup(async () => {
          await maintenance.stop();
        });

        logger.debug("✅ Tracestream backend init complete.");
      },
    });
  },
});
