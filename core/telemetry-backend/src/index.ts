import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { internalSecretsRef } from "@checkstack/secrets-backend";
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";
import {
  telemetryAccessRules,
  pluginMetadata,
} from "@checkstack/telemetry-common";
import * as schema from "./schema";
import {
  createTelemetrySinkRegistry,
  createTelemetrySourceRegistry,
  telemetrySinkExtensionPoint,
  telemetrySourceExtensionPoint,
} from "./extension-points";
import { registerTelemetry, type TelemetryTeardown } from "./setup";

// The extension points ARE this package's public API: signal-owning plugins
// contribute sinks, any plugin contributes source types.
export * from "./extension-points";
// Shared stream-bind authorization every sink contribution reuses.
export * from "./sink-guards";

/**
 * Telemetry platform backend. Owns the signal-agnostic source/sink
 * abstraction: SINKS adapt normalized records into the stream-owning plugins'
 * pipelines; SOURCE TYPES are pluggable ways telemetry enters the platform
 * (pollers, webhooks); SOURCE INSTANCES are user-configured, team-scoped
 * resources routing a type's signals into bound streams.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerAccessRules(telemetryAccessRules);

    // The plugin owns both registries; contributions are buffered behind the
    // extension points, so load order does not matter.
    const sinkRegistry = createTelemetrySinkRegistry();
    env.registerExtensionPoint(telemetrySinkExtensionPoint, {
      registerSink: (contribution, meta) =>
        sinkRegistry.register(contribution, meta),
    });

    const sourceRegistry = createTelemetrySourceRegistry();
    env.registerExtensionPoint(telemetrySourceExtensionPoint, {
      registerSourceType: (def, meta) => sourceRegistry.register(def, meta),
    });

    // satellite-backend's capability registry (dependency inversion: telemetry,
    // a DOMAIN platform, CONTRIBUTES its pull handler; satellite-backend never
    // imports telemetry). The handle is captured here; the handler is registered
    // in init() once the db / service exist (registration is buffered behind the
    // point, so this is load-order safe). `notifyCapabilityConfigChanged` re-pushes
    // a satellite's pull config on source CRUD.
    const satelliteCapabilities = env.getExtensionPoint(
      satelliteCapabilityExtensionPoint,
    );

    // Captured in init() so afterPluginsReady() can run the initial reconcile
    // once every plugin's source types / sinks are registered.
    let telemetry: TelemetryTeardown | null = null;

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        signalService: coreServices.signalService,
        eventBus: coreServices.eventBus,
        queueManager: coreServices.queueManager,
        internalSecrets: internalSecretsRef,
      },
      init: async ({
        database,
        rpc,
        logger,
        signalService,
        eventBus,
        queueManager,
        internalSecrets,
      }) => {
        // The runtime injects the plugin's schema-scoped db typed generically;
        // narrow it to this plugin's schema (established repo pattern).
        const db = database as SafeDatabase<typeof schema>;

        telemetry = registerTelemetry({
          rpc,
          db,
          sourceRegistry,
          sinkRegistry,
          internalSecrets,
          signalService,
          eventBus,
          queueManager,
          satelliteCapabilities,
          // Caller-scoped satellite-binding authorization re-enters the router
          // over the internal URL (same convention as metricstream's SAT-C gate).
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
          logger,
        });
        env.registerCleanup(() => telemetry?.stop() ?? Promise.resolve());

        logger.debug(
          `Telemetry platform initialized (${sourceRegistry.list().length} source types, ${sinkRegistry.list().length} sinks at init)`,
        );
      },

      // Once cross-plugin registration has settled: converge pull schedules and
      // start pod-local listeners (both idempotent; the recurring reconcile job
      // and the source-changed hook are the ongoing backstops).
      afterPluginsReady: async ({ logger }) => {
        try {
          await telemetry?.reconcileAll();
        } catch (error) {
          logger.warn(
            `telemetry: initial pull reconcile failed: ${String(error)}`,
          );
        }
        try {
          await telemetry?.startListeners();
        } catch (error) {
          logger.warn(
            `telemetry: failed to start listeners: ${String(error)}`,
          );
        }
      },
    });
  },
});
