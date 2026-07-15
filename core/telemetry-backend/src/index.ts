import {
  createBackendPlugin,
  coreServices,
  createServiceRef,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { internalSecretsRef, secretResolverRef } from "@checkstack/secrets-backend";
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
  telemetryDeriveTapExtensionPoint,
} from "./extension-points";
import { createDeriveTapPoint } from "./derive";
import { registerBuiltinDeriveSourceTypes } from "./derive-sources";
import { registerTelemetry, type TelemetryTeardown } from "./setup";
import type { PushTokenVerifier } from "./push-tokens";
import type { TelemetrySourceLifecycle } from "./service";
import { backfillPromotedSourceGrants } from "./grant-backfill";

// The extension points ARE this package's public API: signal-owning plugins
// contribute sinks, any plugin contributes source types.
export * from "./extension-points";
// Consumer-facing cross-pod hooks: push-endpoint-owning plugins subscribe to
// converge their ingest-auth caches on token mint/revoke.
export {
  telemetryPushTokenInvalidatedHook,
  type TelemetryPushTokenInvalidatedPayload,
} from "./events";
// Shared stream-bind authorization every sink contribution reuses.
export * from "./sink-guards";
// PUSH mode: the verifier service + the ingest-token lookup adapter endpoint
// owners consume to authenticate presented push tokens.
export * from "./push-tokens";
// The source-lifecycle surface a signal-owning plugin calls on stream deletion.
export type { TelemetrySourceLifecycle } from "./service";

/**
 * Cross-plugin push-token verifier. An endpoint-owning plugin (any push source
 * type's owner - the built-in stream plugins are ordinary consumers) injects
 * this to authenticate presented bearer tokens: build an ingest-token lookup
 * with `createPushTokenLookup({ verifier, sourceTypeId, signal })`, feed it to
 * `createIngestAuthenticator`, and call `verifier.recordPushSeen(sourceId)`
 * after a successful delivery. Backend-only - never exposed to a browser.
 */
export const telemetryPushTokenVerifierRef =
  createServiceRef<PushTokenVerifier>("telemetry.pushTokenVerifier");

/**
 * Cross-plugin source-lifecycle service. A SIGNAL-OWNING plugin (logstream,
 * metricstream, tracestream) injects this and calls `handleStreamDeleted` when
 * it deletes one of its streams, so the platform cascades: sources left with no
 * bindings are fully deleted (secrets, schedule, push-token revoke) and sources
 * that keep other bindings drop the deleted one and evict their push verdict.
 * Idempotent and safe to call after the stream row is already gone. Backend-only.
 */
export const telemetrySourceLifecycleRef =
  createServiceRef<TelemetrySourceLifecycle>("telemetry.sourceLifecycle");

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

    // Built-in signal-to-signal DERIVE source types (log-to-metric,
    // log-to-trace) - platform-generic, so the platform registers them itself.
    registerBuiltinDeriveSourceTypes({
      point: {
        registerSourceType: (def, meta) => sourceRegistry.register(def, meta),
      },
      pluginMetadata,
    });

    // The derive TAP point: sink-owning plugins connect their post-flush
    // batches here (buffered); setup() activates it with the dispatcher.
    const deriveTapPoint = createDeriveTapPoint();
    env.registerExtensionPoint(telemetryDeriveTapExtensionPoint, deriveTapPoint.point);

    // The push-token verifier needs the db, which only exists in init(). Register
    // a bridge now (register phase, where registerService lives) that delegates
    // to the real verifier set once setup() runs - mirrors secrets-backend's
    // holder bridge. Consumers resolve the ref and call it at ingest time, long
    // after init() has filled the holder.
    let pushTokenVerifier: PushTokenVerifier | null = null;
    env.registerService(telemetryPushTokenVerifierRef, {
      lookupPushToken: (input) => {
        if (!pushTokenVerifier) {
          throw new Error(
            "telemetry: push-token verifier not initialized yet",
          );
        }
        return pushTokenVerifier.lookupPushToken(input);
      },
      recordPushSeen: async (sourceId) => {
        // Best-effort: silently no-op if a push somehow lands before init().
        await pushTokenVerifier?.recordPushSeen(sourceId);
      },
    });

    // The source-lifecycle service (stream-deletion cascade) is the db-backed
    // service too, so it uses the same register-phase bridge as the verifier.
    let sourceLifecycle: TelemetrySourceLifecycle | null = null;
    env.registerService(telemetrySourceLifecycleRef, {
      handleStreamDeleted: async (input) => {
        if (!sourceLifecycle) {
          throw new Error(
            "telemetry: source lifecycle not initialized yet",
          );
        }
        await sourceLifecycle.handleStreamDeleted(input);
      },
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
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
        signalService: coreServices.signalService,
        eventBus: coreServices.eventBus,
        queueManager: coreServices.queueManager,
        instanceRuntime: coreServices.instanceRuntime,
        advisoryLock: coreServices.advisoryLock,
        internalSecrets: internalSecretsRef,
        secretResolver: secretResolverRef,
      },
      init: async ({
        database,
        rpc,
        rpcClient,
        logger,
        signalService,
        eventBus,
        queueManager,
        instanceRuntime,
        internalSecrets,
        secretResolver,
      }) => {
        // The runtime injects the plugin's schema-scoped db typed generically;
        // narrow it to this plugin's schema (established repo pattern).
        const db = database as SafeDatabase<typeof schema>;

        telemetry = registerTelemetry({
          rpc,
          rpcClient,
          db,
          sourceRegistry,
          sinkRegistry,
          deriveTapPoint,
          secretResolver,
          internalSecrets,
          signalService,
          eventBus,
          queueManager,
          satelliteCapabilities,
          instanceRuntime,
          // Caller-scoped satellite-binding authorization re-enters the router
          // over the internal URL (same convention as metricstream's SAT-C gate).
          internalUrl: process.env.INTERNAL_URL || "http://localhost:3000",
          logger,
        });
        // Back the push-token verifier + source-lifecycle bridges registered in
        // register().
        pushTokenVerifier = telemetry.pushTokenVerifier;
        sourceLifecycle = telemetry.sourceLifecycle;
        env.registerCleanup(() => telemetry?.stop() ?? Promise.resolve());

        logger.debug(
          `Telemetry platform initialized (${sourceRegistry.list().length} source types, ${sinkRegistry.list().length} sinks at init)`,
        );
      },

      // Once cross-plugin registration has settled: converge pull schedules and
      // start pod-local listeners (both idempotent; the recurring reconcile job
      // and the source-changed hook are the ongoing backstops).
      afterPluginsReady: async ({
        database,
        rpcClient,
        advisoryLock,
        internalSecrets,
        logger,
      }) => {
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
        // One-shot: backfill team grants for sources the platform promotions
        // migrated in WITHOUT grants (see grant-backfill.ts). Runs here so every
        // signal owner's sink (and its `streamResourceType`) is registered and
        // auth-backend is ready. Advisory-locked + marker-gated + fail-open.
        try {
          await backfillPromotedSourceGrants({
            db: database as SafeDatabase<typeof schema>,
            sinkRegistry,
            rpcClient,
            internalSecrets,
            advisoryLock,
            logger,
          });
        } catch (error) {
          logger.warn(
            `telemetry: promoted-grants backfill failed; continuing: ${String(error)}`,
          );
        }
      },
    });
  },
});
