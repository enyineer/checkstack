/**
 * Telemetry backend wiring: builds the config-secret store, the source-instance
 * service + oRPC router, the webhook HTTP handler, and the pull reconciler +
 * runner, and registers them. Called from `index.ts`'s `init()`.
 *
 * All run/schedule state lives in Postgres, so any pod may run any pull fire and
 * every pod computes the same reconcile plan (state-and-scale).
 */

import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import type {
  EventBus,
  InstanceRuntime,
  Logger,
  RpcClient,
  RpcService,
  SafeDatabase,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import {
  createDeriveDispatcher,
  type DeriveStore,
  type createDeriveTapPoint,
} from "./derive";
import type { SecretResolverService } from "@checkstack/secrets-backend";
import { createSourceTokenKit, RateLimiter } from "@checkstack/ingest-utils";
import type { SatelliteCapabilityRegistry } from "@checkstack/satellite-backend";
import {
  telemetryContract,
  TELEMETRY_PULL_CAPABILITY_KIND,
} from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import { createSourceSecretStore } from "./secrets";
import {
  createTelemetryService,
  type TelemetrySourceLifecycle,
} from "./service";
import { createPushTokenVerifier, type PushTokenVerifier } from "./push-tokens";
import { createTelemetryRouter } from "./router";
import {
  createWebhookHandler,
  TELEMETRY_WEBHOOK_PATH_PREFIX,
} from "./webhooks";
import {
  createPullReconciler,
  type PullSourceLister,
  type ReconcileSourceRow,
} from "./reconciler";
import { createPullRunner, type PullRunStore } from "./runner";
import { createListenerManager, type ListenerStore } from "./listeners";
import { createSatelliteBindingAuthorizer } from "./satellite/binding-auth-client";
import { registerSatellitePullCapability } from "./satellite/setup";
import type {
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "./extension-points";

/** FROZEN webhook-secret token prefix. */
export const TELEMETRY_WEBHOOK_TOKEN_PREFIX = "ckwh_";

type Db = SafeDatabase<typeof schema>;

export interface TelemetryTeardown {
  /** Converge every pull schedule (call after plugins are ready). */
  reconcileAll(): Promise<void>;
  /** Start pod-local listeners (call after plugins are ready). */
  startListeners(): Promise<void>;
  /**
   * The push-token verifier (db-backed). Exposed so `index.ts` can back the
   * `telemetryPushTokenVerifierRef` bridge registered in `register()` (the
   * verifier needs the db, which only exists in `init()`).
   */
  pushTokenVerifier: PushTokenVerifier;
  /**
   * The source-lifecycle surface (stream-deletion cascade). Exposed so
   * `index.ts` can back the `telemetrySourceLifecycleRef` bridge registered in
   * `register()`, same pattern as the verifier.
   */
  sourceLifecycle: TelemetrySourceLifecycle;
  /** Stop the reconciler + listeners (best-effort). */
  stop(): Promise<void>;
}

export function registerTelemetry({
  rpc,
  rpcClient,
  db,
  sourceRegistry,
  sinkRegistry,
  internalSecrets,
  signalService,
  eventBus,
  queueManager,
  satelliteCapabilities,
  deriveTapPoint,
  secretResolver,
  instanceRuntime,
  internalUrl,
  logger,
}: {
  rpc: RpcService;
  /** S2S client, threaded to the service for team-grant cleanup on delete. */
  rpcClient: RpcClient;
  db: Db;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  internalSecrets: InternalSecretsService;
  signalService: SignalService;
  eventBus: EventBus;
  queueManager: QueueManager;
  /** Which instance this backend runs as; gates pod-local listeners on a
   * namespaced secondary instance (port isolation). */
  instanceRuntime: InstanceRuntime;
  /** satellite-backend's capability registry (dependency inversion contribute). */
  satelliteCapabilities: SatelliteCapabilityRegistry;
  /** The buffered derive-tap point created in register(); activated here once
   * the dispatcher exists. */
  deriveTapPoint: ReturnType<typeof createDeriveTapPoint>;
  /** `${{ secrets.NAME }}` resolver, threaded to the satellite JIT channel. */
  secretResolver: SecretResolverService;
  /** Internal URL for the caller-scoped satellite-binding gate re-entry. */
  internalUrl: string;
  logger: Logger;
}): TelemetryTeardown {
  const webhookKit = createSourceTokenKit({
    prefix: TELEMETRY_WEBHOOK_TOKEN_PREFIX,
  });
  const secretStore = createSourceSecretStore({ internalSecrets });
  // Shared pod-local soft limiter for the webhook endpoint (keyed per instance).
  const webhookRateLimiter = new RateLimiter();

  /**
   * Shared failure bookkeeping used by the pull runner and listener manager.
   * Atomically increments `consecutiveFailures` and RETURNS the new value so the
   * runner can hand it to the type's `onRunFailure` health hook.
   */
  async function markFailure({
    sourceId,
    at,
    error,
  }: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<{ consecutiveFailures: number }> {
    const [updated] = await db
      .update(telemetrySources)
      .set({
        lastRunAt: at,
        lastError: error,
        consecutiveFailures: sql`${telemetrySources.consecutiveFailures} + 1`,
        updatedAt: at,
      })
      .where(eq(telemetrySources.id, sourceId))
      .returning({
        consecutiveFailures: telemetrySources.consecutiveFailures,
      });
    return { consecutiveFailures: updated?.consecutiveFailures ?? 0 };
  }

  // Pull scheduling: DB-backed lister + run store, the runner, then the
  // reconciler that schedules per-instance recurring jobs.
  const lister: PullSourceLister = {
    async listAll() {
      return db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          enabled: telemetrySources.enabled,
          intervalSeconds: telemetrySources.intervalSeconds,
          satelliteId: telemetrySources.satelliteId,
        })
        .from(telemetrySources);
    },
    async get(sourceId): Promise<ReconcileSourceRow | null> {
      const [row] = await db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          enabled: telemetrySources.enabled,
          intervalSeconds: telemetrySources.intervalSeconds,
          satelliteId: telemetrySources.satelliteId,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.id, sourceId))
        .limit(1);
      return row ?? null;
    },
  };

  const runStore: PullRunStore = {
    async load(sourceId) {
      const [row] = await db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          name: telemetrySources.name,
          enabled: telemetrySources.enabled,
          satelliteId: telemetrySources.satelliteId,
          config: telemetrySources.config,
          bindings: telemetrySources.bindings,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.id, sourceId))
        .limit(1);
      return row ?? null;
    },
    async markSuccess({ sourceId, at }) {
      // Reset the failure counter ONLY when it is currently non-zero, returning
      // a row iff the reset actually applied. That row's presence tells us this
      // success RECOVERED the source from recorded failures - and because the
      // conditional UPDATE is a single atomic statement, exactly one pod's write
      // matches `consecutiveFailures > 0`, so recovery is reported exactly once.
      const recovered = await db
        .update(telemetrySources)
        .set({
          lastRunAt: at,
          lastError: null,
          consecutiveFailures: 0,
          updatedAt: at,
        })
        .where(
          and(
            eq(telemetrySources.id, sourceId),
            gt(telemetrySources.consecutiveFailures, 0),
          ),
        )
        .returning({ id: telemetrySources.id });
      if (recovered.length > 0) return { recovered: true };
      // Already healthy: just stamp the run time (no counter change needed).
      await db
        .update(telemetrySources)
        .set({ lastRunAt: at, updatedAt: at })
        .where(eq(telemetrySources.id, sourceId));
      return { recovered: false };
    },
    markFailure,
  };

  const runner = createPullRunner({
    store: runStore,
    sourceRegistry,
    sinkRegistry,
    secretStore,
    logger,
  });

  // DERIVE dispatcher: routes sink-owners' post-flush batches to the enabled
  // derive instances on that input stream (pod-local hook-invalidated cache).
  const deriveStore: DeriveStore = {
    async listEnabled() {
      return db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          enabled: telemetrySources.enabled,
          config: telemetrySources.config,
          bindings: telemetrySources.bindings,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.enabled, true));
    },
    // The derive store's bookkeeping is void; discard the runner store's
    // recovery/count return values it does not use.
    markSuccess: async (input) => {
      await runStore.markSuccess(input);
    },
    markFailure: async (input) => {
      await markFailure(input);
    },
  };
  const deriveDispatcher = createDeriveDispatcher({
    store: deriveStore,
    sourceRegistry,
    sinkRegistry,
    secretStore,
    eventBus,
    logger,
  });
  deriveTapPoint.activate(deriveDispatcher.dispatchForSignal);
  void deriveDispatcher.start().catch((error: unknown) => {
    logger.warn(`telemetry: derive dispatcher subscribe failed: ${String(error)}`);
  });

  const reconciler = createPullReconciler({
    queueManager,
    lister,
    runner,
    sourceRegistry,
    logger,
  });

  // Pod-local listener manager (long-lived inbound sockets held by THIS pod).
  const listenerStore: ListenerStore = {
    async listStartable() {
      return db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          enabled: telemetrySources.enabled,
          config: telemetrySources.config,
          bindings: telemetrySources.bindings,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.enabled, true));
    },
    async get(sourceId) {
      const [row] = await db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          enabled: telemetrySources.enabled,
          config: telemetrySources.config,
          bindings: telemetrySources.bindings,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.id, sourceId))
        .limit(1);
      return row ?? null;
    },
    // The listener store's markFailure is void; drop the shared count return.
    markFailure: async (input) => {
      await markFailure(input);
    },
  };

  const listenerManager = createListenerManager({
    store: listenerStore,
    sourceRegistry,
    sinkRegistry,
    secretStore,
    instanceRuntime,
    eventBus,
    logger,
  });

  const service = createTelemetryService({
    db,
    sourceRegistry,
    sinkRegistry,
    internalSecretsStore: secretStore,
    signalService,
    eventBus,
    rpcClient,
    webhookKit,
    reconcile: {
      scheduleSource: (input) => reconciler.reconcileSource(input),
      unscheduleSource: (input) => reconciler.removeSource(input),
    },
    // SSRF-pivot guard for a caller-supplied satelliteId (re-enters getSatellite
    // as the caller over the internal URL, same convention as metricstream).
    assertSatelliteBindable: createSatelliteBindingAuthorizer({ internalUrl }),
    // Low-latency satellite re-push on a source CRUD that touches a bound
    // instance; the satellite's reconnect re-push is the convergence backstop.
    satellitePush: {
      notifyConfigChanged: ({ satelliteId }) =>
        satelliteCapabilities.notifyCapabilityConfigChanged({
          kind: TELEMETRY_PULL_CAPABILITY_KIND,
          satelliteId,
        }),
    },
    logger,
  });

  // Contribute the satellite pull-capability handler (dependency inversion: the
  // telemetry platform contributes; satellite-backend never imports telemetry).
  registerSatellitePullCapability({
    registry: satelliteCapabilities,
    db,
    sourceRegistry,
    sinkRegistry,
    secretStore,
    secretResolver,
    logger,
  });

  // Push-token verifier: the READ side endpoint-owning plugins consume through
  // `telemetryPushTokenVerifierRef` to authenticate presented push tokens.
  const pushTokenVerifier = createPushTokenVerifier({ db, logger });

  rpc.registerRouter(createTelemetryRouter({ service }), telemetryContract);

  rpc.registerHttpHandler(
    createWebhookHandler({
      loadSource: async (sourceId) => {
        const [row] = await db
          .select({
            id: telemetrySources.id,
            sourceTypeId: telemetrySources.sourceTypeId,
            config: telemetrySources.config,
            bindings: telemetrySources.bindings,
            enabled: telemetrySources.enabled,
            webhookSecretHash: telemetrySources.webhookSecretHash,
          })
          .from(telemetrySources)
          .where(eq(telemetrySources.id, sourceId))
          .limit(1);
        return row ?? null;
      },
      sourceRegistry,
      sinkRegistry,
      resolveRunnableConfig: (input) => service.resolveRunnableConfig(input),
      webhookKit,
      resolveWebhookSecret: (sourceId) =>
        secretStore.resolveWebhookSecret({ sourceId }),
      // Persist the "no stored HMAC key" health condition WITHOUT bumping the
      // failure counter: it recurs on every delivery, so set-if-different only
      // (the `where` skips the write when `lastError` already matches).
      markSignatureUnverifiable: async ({ sourceId, message }) => {
        await db
          .update(telemetrySources)
          .set({ lastError: message, updatedAt: new Date() })
          .where(
            and(
              eq(telemetrySources.id, sourceId),
              or(
                isNull(telemetrySources.lastError),
                ne(telemetrySources.lastError, message),
              ),
            ),
          );
      },
      rateLimiter: webhookRateLimiter,
      logger,
    }),
    TELEMETRY_WEBHOOK_PATH_PREFIX,
  );

  // Register the pull + reconcile consumers and the recurring reconcile job.
  void reconciler.start().catch((error: unknown) => {
    logger.warn(
      `telemetry: failed to start pull reconciler: ${String(error)}`,
    );
  });

  return {
    reconcileAll: () => reconciler.reconcileAll(),
    startListeners: () => listenerManager.start(),
    pushTokenVerifier,
    sourceLifecycle: service,
    async stop() {
      await reconciler.stop();
      await listenerManager.stop();
      await deriveDispatcher.stop();
    },
  };
}
