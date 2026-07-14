/**
 * Telemetry backend wiring: builds the config-secret store, the source-instance
 * service + oRPC router, the webhook HTTP handler, and the pull reconciler +
 * runner, and registers them. Called from `index.ts`'s `init()`.
 *
 * All run/schedule state lives in Postgres, so any pod may run any pull fire and
 * every pod computes the same reconcile plan (state-and-scale).
 */

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type {
  EventBus,
  Logger,
  RpcService,
  SafeDatabase,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { createSourceTokenKit, RateLimiter } from "@checkstack/ingest-utils";
import type { SatelliteCapabilityRegistry } from "@checkstack/satellite-backend";
import {
  telemetryContract,
  TELEMETRY_PULL_CAPABILITY_KIND,
} from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import { createSourceSecretStore } from "./secrets";
import { createTelemetryService } from "./service";
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
  /** Stop the reconciler + listeners (best-effort). */
  stop(): Promise<void>;
}

export function registerTelemetry({
  rpc,
  db,
  sourceRegistry,
  sinkRegistry,
  internalSecrets,
  signalService,
  eventBus,
  queueManager,
  satelliteCapabilities,
  internalUrl,
  logger,
}: {
  rpc: RpcService;
  db: Db;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  internalSecrets: InternalSecretsService;
  signalService: SignalService;
  eventBus: EventBus;
  queueManager: QueueManager;
  /** satellite-backend's capability registry (dependency inversion contribute). */
  satelliteCapabilities: SatelliteCapabilityRegistry;
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

  /** Shared failure bookkeeping used by the pull runner and listener manager. */
  async function markFailure({
    sourceId,
    at,
    error,
  }: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<void> {
    await db
      .update(telemetrySources)
      .set({
        lastRunAt: at,
        lastError: error,
        consecutiveFailures: sql`${telemetrySources.consecutiveFailures} + 1`,
        updatedAt: at,
      })
      .where(eq(telemetrySources.id, sourceId));
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
      await db
        .update(telemetrySources)
        .set({
          lastRunAt: at,
          lastError: null,
          consecutiveFailures: 0,
          updatedAt: at,
        })
        .where(eq(telemetrySources.id, sourceId));
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
    markFailure,
  };

  const listenerManager = createListenerManager({
    store: listenerStore,
    sourceRegistry,
    sinkRegistry,
    secretStore,
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
    logger,
  });

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
    async stop() {
      await reconciler.stop();
      await listenerManager.stop();
    },
  };
}
