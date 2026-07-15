import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { eq, inArray } from "drizzle-orm";
import {
  secretResolverRef,
  internalSecretsRef,
} from "@checkstack/secrets-backend";
import {
  pluginMetadata,
  metricstreamAccessRules,
  metricstreamContract,
} from "@checkstack/metricstream-common";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import {
  telemetrySinkExtensionPoint,
  telemetrySourceExtensionPoint,
  telemetryPushTokenVerifierRef,
  telemetrySourceLifecycleRef,
} from "@checkstack/telemetry-backend";
import {
  aiToolProjectionExtensionPoint,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import * as schema from "./schema";
import { projectStreamListForModel } from "./ai-projections";
import { createMetricstreamTelemetrySink } from "./telemetry-sink";
import { registerSatelliteCapabilities } from "./satellite/setup";
import { createStorage } from "./storage";
import { createImportantEventRecorder } from "./events/recorder";
import { createPrometheusScrapeSourceType } from "./sources/prometheus/source-type";
import { createMetricstreamPushSourceType } from "./sources/push/source-type";
import { rekeyMigratedScrapeBearers } from "./sources/prometheus/rekey";
import { registerSources } from "./sources/setup";
import { registerIngest } from "./ingest/setup";
import { registerHealthIntegration } from "./health/setup";
import { registerMaintenance } from "./health/maintenance";
import { registerApi } from "./api/setup";

/**
 * Metric stream backend plugin. Thin orchestration: it builds the shared
 * storage, recorder and source registry, then hands each area its setup function
 * (ingest / sources / health / api / maintenance). Those setup functions are the
 * seams the Phase-C agents implement; Phase B2 ships them as compiling stubs.
 *
 * Metrics enter through two directly-wired push endpoints (OTLP, native) and
 * through the telemetry platform: the plugin contributes the "metrics" SINK, the
 * `push` source type (whose per-instance tokens the platform mints - metricstream
 * only serves the endpoints and verifies presented tokens), and the
 * `prometheus-scrape` PULL source type to the platform's extension points (the
 * former private metric-source extension point is gone - the platform is the one
 * pluggable source seam).
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerAccessRules(metricstreamAccessRules);

    // Bridges init() -> afterPluginsReady(): maintenance scheduling waits until
    // every plugin's router is registered - the retention pass resolves
    // healthcheck-referenced metric names over cross-plugin RPC, and an overdue
    // job firing mid-boot would 404 and skip its sweep.
    let startMaintenance: (() => void) | null = null;

    // Bridges init() -> afterPluginsReady(): the migrated-scrape-bearer re-key
    // re-stores secrets through telemetry's PUBLIC update RPC, which is only
    // routable once every plugin's router is registered.
    let runScrapeBearerRekey: (() => Promise<void>) | null = null;

    // Satellite capability contribution (dependency inversion: metricstream, a
    // DOMAIN plugin, CONTRIBUTES handlers to satellite-backend, the platform
    // host). The handle is captured here; the handler is registered in init()
    // once the sink / auth / db exist (registration is buffered, so this is
    // load-order safe).
    const satelliteCapabilities = env.getExtensionPoint(
      satelliteCapabilityExtensionPoint,
    );

    // Telemetry SOURCE-TYPE contribution: metricstream contributes the
    // "prometheus-scrape" pull source type to the telemetry platform (which owns
    // scheduling + satellite dispatch). Captured here; registered in init() once
    // secretResolver exists (buffered behind the point, load-order safe).
    const telemetrySource = env.getExtensionPoint(telemetrySourceExtensionPoint);

    // Telemetry SINK contribution (dependency inversion: metricstream OWNS the
    // "metrics" signal and contributes its sink to the telemetry platform). The
    // handle is captured here; the sink is registered in init() once the shared
    // ingest sink + db exist (registration is buffered behind the point, so this
    // is load-order safe - mirrors satelliteCapabilities above).
    const telemetrySink = env.getExtensionPoint(telemetrySinkExtensionPoint);

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
        advisoryLock: coreServices.advisoryLock,
        internalSecrets: internalSecretsRef,
        secretResolver: secretResolverRef,
        pushTokenVerifier: telemetryPushTokenVerifierRef,
        // The platform source-lifecycle service: `deleteStream` calls
        // `handleStreamDeleted` so deleting a stream cascades to bound sources.
        sourceLifecycle: telemetrySourceLifecycleRef,
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
        advisoryLock,
        internalSecrets,
        secretResolver,
        pushTokenVerifier,
        sourceLifecycle,
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

        const ingest = registerIngest({
          rpc,
          db,
          storage,
          recorder,
          cacheManager,
          signalService,
          logger,
          instanceRuntime,
          verifier: pushTokenVerifier,
          eventBus,
        });
        // Final flush + timer teardown on deregister/shutdown so the last
        // buffered datapoints are not dropped (stop() is idempotent).
        env.registerCleanup(ingest.stop);

        // Wire the OTLP + native metric PUSH endpoints against the shared sink.
        registerSources({
          rpc,
          sink: ingest.sink,
          auth: ingest.auth,
          verifier: pushTokenVerifier,
          logger,
          configResolver: ingest.configResolver,
        });

        // Contribute the "push" telemetry source type: a push instance owns a
        // platform-minted `ckms_` token; metricstream serves the OTLP + native
        // endpoints and verifies presented tokens through the push verifier. The
        // qualified id `metricstream.push` matches the telemetry migration that
        // promoted the legacy token rows into push source instances.
        telemetrySource.registerSourceType(
          createMetricstreamPushSourceType(),
          pluginMetadata,
        );

        // Contribute the "prometheus-scrape" telemetry source type. The platform
        // owns its scheduling (core reconciler) and satellite dispatch (generic
        // telemetry-pull capability); the execute closes over `secretResolver` so
        // a `${{ secrets.NAME }}` bearer reference resolves at run time.
        telemetrySource.registerSourceType(
          createPrometheusScrapeSourceType({ secretResolver, recorder }),
          pluginMetadata,
        );

        // One-shot: re-key any MIGRATED scrape-target bearer (a metricstream
        // inline-secret marker) into telemetry's own secret store. Deferred to
        // afterPluginsReady since it re-stores via telemetry's update RPC.
        runScrapeBearerRekey = async () => {
          if (!rpcClient) {
            logger.warn(
              "metricstream: rpcClient unavailable; skipping migrated scrape-bearer re-key",
            );
            return;
          }
          await rekeyMigratedScrapeBearers({
            rpcClient,
            internalSecrets,
            advisoryLock,
            logger,
          });
        };

        // Contribute the telemetry "metrics" sink: telemetry sources route their
        // normalized points through the SAME shared ingest sink the push/scrape
        // paths use (clamping, buffering, cardinality caps and folding all apply
        // uniformly). Existence + display name resolve straight off the streams
        // table (the push path relies on the source token instead; there is no
        // shared "get stream by id" helper to reuse).
        telemetrySink.registerSink(
          createMetricstreamTelemetrySink({
            resolveStream: async (streamId) => {
              const [row] = await db
                .select({
                  id: schema.metricStreams.id,
                  name: schema.metricStreams.name,
                })
                .from(schema.metricStreams)
                .where(eq(schema.metricStreams.id, streamId))
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
                  id: schema.metricStreams.id,
                  name: schema.metricStreams.name,
                })
                .from(schema.metricStreams)
                .where(inArray(schema.metricStreams.id, streamIds));
              for (const row of rows) resolved[row.id] = row;
              return resolved;
            },
            // List all streams (id + name) for the telemetry binding picker; the
            // sink filters them to the caller's manageable subset.
            listStreams: async () =>
              db
                .select({
                  id: schema.metricStreams.id,
                  name: schema.metricStreams.name,
                })
                .from(schema.metricStreams),
            sink: ingest.sink,
            auth,
            logger,
          }),
          pluginMetadata,
        );

        // Contribute the satellite forward capability (a receiver forwards push
        // telemetry it accepted for a stream). Feeds the SAME sink the push path
        // uses; never duplicates fold logic. (Satellite-side scraping is now the
        // platform's generic telemetry-pull capability - see the source type.)
        registerSatelliteCapabilities({
          registry: satelliteCapabilities,
          db,
          sink: ingest.sink,
          auth: ingest.auth,
          verifier: pushTokenVerifier,
          logger,
        });

        const health = registerHealthIntegration({
          rpc,
          db,
          storage,
          cacheManager,
          rpcClient,
          logger,
          healthCheckRegistry,
          collectorRegistry,
        });

        // Deferred to afterPluginsReady (cross-plugin RPC in the retention
        // pass); the cleanup hook is registered immediately with a late-bound
        // handle so shutdown always works.
        let maintenance: ReturnType<typeof registerMaintenance> | null = null;
        startMaintenance = () => {
          maintenance = registerMaintenance({
            queueManager,
            db,
            storage,
            logger,
            getReferencedMetricNames: health.getReferencedMetricNames,
            // Silence events fire the live METRICSTREAM_IMPORTANT_EVENT signal
            // through the shared recorder instead of a bare insert.
            recorder,
          });
        };
        env.registerCleanup(async () => {
          await maintenance?.stop();
        });

        registerApi({
          rpc,
          db,
          storage,
          logger,
          resourceResolverRegistry,
          rpcClient,
          sourceLifecycle,
          // Caller-scoped system-links readability gate re-enters the router over
          // the internal URL (same convention as status-page's publish gate).
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
        });

        // AI read-tool projections of this plugin's OWN read procedures, owned
        // here (not in ai-backend). Each projected tool is routed by the
        // transport (MCP / chat) AS the principal, so the procedure's own
        // contract access rules gate it; `deferredProjectionExecute` is the
        // fail-closed net if a transport ever forgot to route. Chosen
        // aggregate-first (see docs/developer-guide/ai/tool-registry.md): the
        // model discovers streams -> metric names -> queries windowed buckets,
        // and never pulls raw per-series label rows into its context.
        const aiProjection = env.getExtensionPoint(
          aiToolProjectionExtensionPoint,
        );

        // Compact catalog of the streams the caller may read: id + name +
        // description (the full config policy + timestamps are projected away).
        // The entry point - the model resolves a stream id here to feed the two
        // tools below.
        aiProjection.expose({
          procedure: metricstreamContract.listStreams,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "listStreams",
          name: "metricstream.listStreams",
          description:
            "List the metric streams you can read (id, name, description). " +
            "Use this FIRST to find a stream's id, then call " +
            "metricstream.listMetricNames to see its metrics and " +
            "metricstream.metricBuckets to query values. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
          projectResult: projectStreamListForModel,
        });

        // Metric-name discovery for a stream (bounded by `limit`). Compact rows
        // (name, type, unit, series count) - the model needs a metric NAME
        // before it can query buckets, and this is how it discovers what a
        // stream exposes.
        aiProjection.expose({
          procedure: metricstreamContract.listMetricNames,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "listMetricNames",
          name: "metricstream.listMetricNames",
          description:
            "List the metric NAMES registered on a stream, given its " +
            "`streamId` (resolve it with metricstream.listStreams first). " +
            "Optionally filter with `query` and cap with `limit`. Returns each " +
            "metric's name, type, unit and series count. Use this to discover " +
            "what a stream measures before calling metricstream.metricBuckets. " +
            "Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        // The windowed AGGREGATE the charts run on: per-bucket count/sum/min/
        // max/last for a metric selection over a time window. PREFER this for
        // any "what is the value / trend / rate of metric X" question - it
        // returns compact time-bucketed aggregates (grain auto-picked from the
        // window), never raw datapoints. Output is bounded by the window/grain,
        // so no projectResult.
        aiProjection.expose({
          procedure: metricstreamContract.getMetricBuckets,
          sourcePluginMetadata: pluginMetadata,
          procedureKey: "getMetricBuckets",
          name: "metricstream.metricBuckets",
          description:
            "Query a metric's values over a time window as compact time " +
            "buckets (count, sum, min, max, last per bucket). Give `streamId`, " +
            "`metricName` (discover both via metricstream.listStreams then " +
            "metricstream.listMetricNames), a `from`/`to` window, optional " +
            "`labelFilters`, and optional `grain` (else auto-picked minute vs " +
            "hour from the window). PREFER THIS over raw series reads for any " +
            "'what is the value / trend / rate of metric X over the last N " +
            "hours or days' question. Read-only.",
          effect: "read",
          execute: deferredProjectionExecute,
        });

        logger.debug("✅ Metricstream backend init complete.");
      },

      afterPluginsReady: async () => {
        // Phase 3: cross-plugin RPC is now routable; start the recurring
        // rollup/retention/silence jobs, then re-key any migrated scrape bearers
        // (both need the router up).
        startMaintenance?.();
        await runScrapeBearerRekey?.();
      },
    });
  },
});

export { type MetricIngestSink } from "./sources/ingest-sink";
