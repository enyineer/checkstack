import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import { telemetrySinkExtensionPoint } from "@checkstack/telemetry-backend";
import {
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import {
  pluginMetadata,
  logstreamAccessRules,
  logstreamContract,
} from "@checkstack/logstream-common";
import { projectLogEventsForModel } from "./ai-projections";
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
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
        });

        // Expose this plugin's OWN read-only AI projections of existing read
        // procedures via aiToolProjectionExtensionPoint - owned here, not in
        // ai-backend. Each projected tool is routed by the transport (MCP /
        // chat) AS the principal, so the source procedure's own contract access
        // rules gate it; `deferredProjectionExecute` is the fail-closed net if a
        // transport ever forgot to route.
        const aiProjection = env.getExtensionPoint(
          aiToolProjectionExtensionPoint,
        );

        // Raw log search, filterable by text / severity / pattern / trace /
        // time window. The lean projection drops the unbounded attributes/
        // resource jsonb and clamps the body so a page of lines does not blow
        // the model's context on every replay.
        aiProjection.expose({
          procedure: logstreamContract.searchEvents,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "searchEvents",
          name: "logstream.searchLogs",
          description:
            "Search a log stream's raw lines by `streamId`, filtering by " +
            "`text` (substring), `severityBands`, `patternId`, `traceId`, and " +
            "a `from`/`to` time window; keep `limit` small (each line is a " +
            "row). Resolve a stream NAME to its id with logstream.listStreams " +
            "first. For 'how often / how many errors / volume over a window' " +
            "questions, PREFER logstream.severityStats - it returns compact " +
            "counts instead of thousands of raw lines. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
          // Lean shape for the model: drop attributes/resource + opaque ids and
          // clamp the body, keeping time/band/message + correlation handles.
          projectResult: projectLogEventsForModel,
        });

        // Windowed severity counts (the compact "how much / how often" answer).
        // Output is already small and bounded, so no projectResult.
        aiProjection.expose({
          procedure: logstreamContract.getSeverityBuckets,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getSeverityBuckets",
          name: "logstream.severityStats",
          description:
            "Summarize a log stream's volume over a `from`/`to` window as " +
            "per-bucket counts BY SEVERITY band (trace/debug/info/warn/error/" +
            "fatal). PREFER THIS over logstream.searchLogs for any 'how many " +
            "errors / how much log volume / error trend over the last N hours " +
            "or days' question - it returns compact aggregates, not raw rows. " +
            "Resolve a stream NAME to its id with logstream.listStreams first. " +
            "Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // Compact stream directory (id + name) so the model can resolve a
        // stream NAME to the id the other two tools require. `listStreamsForPicker`
        // is the least-privileged compact list (id+name only).
        aiProjection.expose({
          procedure: logstreamContract.listStreamsForPicker,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "listStreamsForPicker",
          name: "logstream.listStreams",
          description:
            "List the log streams the caller can access as compact " +
            "{ id, name } entries. Use this FIRST to resolve a stream NAME to " +
            "the `streamId` that logstream.searchLogs and " +
            "logstream.severityStats require. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
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
