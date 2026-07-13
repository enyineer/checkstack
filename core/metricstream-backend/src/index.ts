import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import {
  secretResolverRef,
  internalSecretsRef,
} from "@checkstack/secrets-backend";
import {
  pluginMetadata,
  metricstreamAccessRules,
  METRIC_SCRAPE_CAPABILITY_KIND,
} from "@checkstack/metricstream-common";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import * as schema from "./schema";
import { registerSatelliteCapabilities } from "./satellite/setup";
import { createStorage } from "./storage";
import { createImportantEventRecorder } from "./events/recorder";
import {
  metricSourceExtensionPoint,
  createMetricSourceRegistry,
} from "./sources/extension-point";
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
 * The plugin OWNS the metric-source extension point and registers its three
 * built-in sources (OTLP push, native push, Prometheus pull) through the SAME
 * point (dogfooding), so a future plugin adds a source type with zero core
 * changes.
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

    // The plugin owns the metric-source registry; expose it as the extension
    // point so built-in AND third-party sources register against it (buffered
    // behind the point, so load order does not matter).
    const sourceRegistry = createMetricSourceRegistry();
    env.registerExtensionPoint(metricSourceExtensionPoint, {
      registerSource: (source, meta) => sourceRegistry.register(source, meta),
    });

    // Satellite capability contribution (dependency inversion: metricstream, a
    // DOMAIN plugin, CONTRIBUTES handlers to satellite-backend, the platform
    // host). The handles are captured here; the handlers are registered in
    // init() once the sink / auth / db exist (registration is buffered, so this
    // is load-order safe). `notifyCapabilityConfigChanged` re-pushes a
    // satellite's scrape config on target CRUD.
    const satelliteCapabilities = env.getExtensionPoint(
      satelliteCapabilityExtensionPoint,
    );

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
        internalSecrets: internalSecretsRef,
        secretResolver: secretResolverRef,
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
        internalSecrets,
        secretResolver,
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
          eventBus,
        });
        // Final flush + timer teardown on deregister/shutdown so the last
        // buffered datapoints are not dropped (stop() is idempotent).
        env.registerCleanup(ingest.stop);

        const sources = registerSources({
          sourceRegistry,
          rpc,
          sink: ingest.sink,
          auth: ingest.auth,
          logger,
          configResolver: ingest.configResolver,
          queueManager,
          db,
          recorder,
          internalSecrets,
          secretResolver,
        });
        // Stop the scrape scheduler/consumer on deregister/shutdown.
        env.registerCleanup(sources.stop);

        // Contribute the satellite capability handlers (forwarded telemetry +
        // satellite-side scraping). Feeds the SAME sink the push/scrape paths
        // use; never duplicates fold logic.
        registerSatelliteCapabilities({
          registry: satelliteCapabilities,
          db,
          sink: ingest.sink,
          auth: ingest.auth,
          recorder,
          internalSecrets,
          secretResolver,
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
          cacheManager,
          signalService,
          logger,
          resourceResolverRegistry,
          rpcClient,
          eventBus,
          tokenKit: ingest.tokenKit,
          auth: ingest.auth,
          internalSecrets,
          secretResolver,
          // Caller-scoped satellite-binding authorization re-enters the router
          // over the internal URL (same convention as status-page's publish gate).
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
          // Post-commit scrape reconcile: low-latency (re)schedule/cancel of
          // the recurring CORE scrape job; the boot reconciler stays the
          // convergence backstop for anything missed. A satellite-bound target
          // is excluded from core scheduling by the reconciler (and the reconcile
          // cancels its old core job on a core->satellite rebind); each affected
          // satellite is re-pushed its scrape config so it converges too (BOTH
          // old and new on a rebind).
          onScrapeTargetsChanged: async ({ targetId, action, satelliteIds }) => {
            await (action === "removed"
              ? sources.removeScrapeTarget({ targetId })
              : sources.reconcileScrapeTarget({ targetId }));
            for (const satelliteId of satelliteIds ?? []) {
              satelliteCapabilities.notifyCapabilityConfigChanged({
                kind: METRIC_SCRAPE_CAPABILITY_KIND,
                satelliteId,
              });
            }
          },
        });

        logger.debug("✅ Metricstream backend init complete.");
      },

      afterPluginsReady: async () => {
        // Phase 3: cross-plugin RPC is now routable; start the recurring
        // rollup/retention/silence jobs.
        startMaintenance?.();
      },
    });
  },
});

export {
  metricSourceExtensionPoint,
  createMetricSourceRegistry,
  type MetricSourceType,
  type MetricSourceRegistry,
  type MetricIngestSink,
  type MetricPullTarget,
  type MetricPullResult,
  type MetricPushSourceContext,
  type MetricPullSourceContext,
} from "./sources/extension-point";
export {
  metricstreamTokensInvalidatedHook,
  type MetricstreamTokensInvalidatedPayload,
} from "./events/bus-hooks";
