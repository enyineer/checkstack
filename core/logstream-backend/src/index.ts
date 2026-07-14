import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import { telemetrySinkExtensionPoint } from "@checkstack/telemetry-backend";
import {
  pluginMetadata,
  logstreamAccessRules,
} from "@checkstack/logstream-common";
import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import { createStorage } from "./storage";
import { createLogstreamTelemetrySink } from "./telemetry-sink";
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
        auth: coreServices.auth,
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
        auth,
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

        // Contribute the telemetry "logs" sink: telemetry sources route their
        // normalized records through the SAME pipeline + stream config the push
        // endpoints use, so banding, rate limits, buffering and sampling apply
        // identically. Existence + display name resolve straight off the streams
        // table (the push path relies on the source token instead; there is no
        // shared "get stream by id" helper to reuse).
        env.getExtensionPoint(telemetrySinkExtensionPoint).registerSink(
          createLogstreamTelemetrySink({
            resolveStream: async (streamId) => {
              const [row] = await db
                .select({
                  id: schema.logStreams.id,
                  name: schema.logStreams.name,
                })
                .from(schema.logStreams)
                .where(eq(schema.logStreams.id, streamId))
                .limit(1);
              return row ?? null;
            },
            // Batched resolver for source LIST read paths: one set-based select
            // over the bound ids, keyed by id (unknown ids map to null).
            resolveStreams: async (streamIds) => {
              const resolved: Record<
                string,
                { id: string; name: string } | null
              > = {};
              for (const id of streamIds) resolved[id] = null;
              if (streamIds.length === 0) return resolved;
              const rows = await db
                .select({
                  id: schema.logStreams.id,
                  name: schema.logStreams.name,
                })
                .from(schema.logStreams)
                .where(inArray(schema.logStreams.id, streamIds));
              for (const row of rows) resolved[row.id] = row;
              return resolved;
            },
            // List all streams (id + name) for the telemetry binding picker; the
            // sink filters them to the caller's manageable subset.
            listStreams: async () =>
              db
                .select({
                  id: schema.logStreams.id,
                  name: schema.logStreams.name,
                })
                .from(schema.logStreams),
            pipeline: ingest.pipeline,
            configResolver: ingest.configResolver,
            auth,
            logger,
          }),
          pluginMetadata,
        );

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
