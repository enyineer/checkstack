import type {
  SafeDatabase,
  Logger,
  RpcService,
  EventBus,
  HookUnsubscribe,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import type { SignalService } from "@checkstack/signal-common";
import { pluginMetadata } from "@checkstack/logstream-common";
import {
  createPushTokenLookup,
  telemetryPushTokenInvalidatedHook,
  type PushTokenVerifier,
  type TelemetryPushTokenInvalidatedPayload,
} from "@checkstack/telemetry-backend";
import { createIngestTokenCache, ingestTokenCacheKey } from "../api/token-cache";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { DrainEngine } from "../drain/engine";
import type { ImportantEventRecorder } from "../events/recorder";
import type { OnIngestFlush } from "../health/setup";
import {
  logstreamPatternsChangedHook,
  type LogstreamPatternsChangedPayload,
} from "../events/bus-hooks";
import {
  createIngestAuthenticator,
  ingestTokenMissKey,
  type IngestAuthenticator,
} from "./auth";
import { LOGSTREAM_PUSH_SOURCE_TYPE_ID } from "./push/source-type";
import {
  createStreamConfigResolver,
  type StreamConfigResolver,
} from "./stream-config";
import {
  createIngestPipeline,
  type IngestPipeline,
  type GetReferencedPatternIds,
} from "./pipeline";
import { type FlushExecutor } from "./flush-executor";
import { createFlushExecutor } from "./flush-executor-factory";
import { createOtlpLogsHandler } from "./endpoints/otlp";
import { createNativeIngestHandler } from "./endpoints/native";
import { createLogstreamSatelliteCapabilityHandler } from "./satellite-handler";
import type { LogDeriveTap } from "./derive-tap";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";

/**
 * Converge this pod's ingest-auth caches to a platform push-token lifecycle
 * event ({@link telemetryPushTokenInvalidatedHook}). The PLATFORM now owns push
 * instance lifecycle (create/rotate/enable/disable/delete) and emits this hook,
 * so unlike the old logstream-owned API path there is NO other writer clearing
 * the SHARED cache - this consumer does both the shared-cache converge and the
 * pod-local negative-cache clear. Exported for unit testing.
 *
 * - `revoked`: the token stopped authorizing. Delete the SHARED positive verdict
 *   key (so no pod keeps serving a cached `ok`) and the shared miss marker for
 *   the hash.
 * - `minted`: a token became valid. Clear the pod-local negative (unknown-token)
 *   cache for the hash AND delete the shared miss marker, so a token probed just
 *   before it existed is not shadowed for the negative TTL.
 *
 * The caller filters on `sourceTypeId === "logstream.push"`, so a foreign push
 * type's event never reaches here.
 */
export async function applyPushTokenInvalidation({
  payload,
  auth,
  cache,
}: {
  payload: TelemetryPushTokenInvalidatedPayload;
  auth: IngestAuthenticator;
  cache: CachedScope;
}): Promise<void> {
  if (payload.reason === "revoked") {
    await cache.invalidate(ingestTokenCacheKey(payload.tokenHash));
    await cache.invalidate(ingestTokenMissKey(payload.tokenHash));
    return;
  }
  // minted
  await auth.clearNegative?.(payload.tokenHash);
  await cache.invalidate(ingestTokenMissKey(payload.tokenHash));
}

/**
 * Apply a `logstream.patterns.changed` broadcast to this pod's Drain tree so a
 * user pattern authored/deleted on another pod classifies (or stops classifying)
 * here immediately, instead of waiting for the next hydration. Routed through the
 * flush {@link FlushExecutor} so it reaches wherever the tree physically lives -
 * the main thread (in-process executor) or the stream's owning worker.
 * Exported for unit testing.
 *
 * - `upserted`: install the protected user cluster (`upsertUserPattern`).
 * - `removed`: drop it (`removeUserPattern`).
 * - `hidden-changed`: flip the pattern's hidden flag (`setPatternHidden`).
 *
 * Idempotent on all methods, so a redelivered event is harmless.
 */
export function applyPatternsChanged({
  payload,
  executor,
}: {
  payload: LogstreamPatternsChangedPayload;
  executor: Pick<
    FlushExecutor,
    "upsertUserPattern" | "removeUserPattern" | "setPatternHidden"
  >;
}): void {
  switch (payload.action) {
    case "upserted": {
      executor.upsertUserPattern({
        streamId: payload.streamId,
        template: payload.template,
      });
      return;
    }
    case "removed": {
      executor.removeUserPattern({
        streamId: payload.streamId,
        patternId: payload.patternId,
      });
      return;
    }
    case "hidden-changed": {
      executor.setPatternHidden({
        streamId: payload.streamId,
        patternId: payload.patternId,
        hidden: payload.hidden ?? false,
      });
      return;
    }
  }
}

/**
 * The syslog listener is now a telemetry SOURCE instance configured in the UI,
 * not an env-gated intake, so the legacy `CHECKSTACK_LOGSTREAM_SYSLOG_PORT` env
 * var no longer has any effect. Returns the operator-facing warning to log when
 * it is still set on boot - so an upgrade that left it set does not SILENTLY lose
 * syslog intake - or null when it is unset/blank. Exported for unit testing.
 */
export function removedSyslogPortEnvWarning({
  env = process.env,
}: { env?: Record<string, string | undefined> } = {}): string | null {
  const value = env.CHECKSTACK_LOGSTREAM_SYSLOG_PORT;
  if (!value || value.trim() === "") return null;
  return (
    "logstream: CHECKSTACK_LOGSTREAM_SYSLOG_PORT is set but no longer has any " +
    "effect. Syslog intake is now a Syslog telemetry source configured in the " +
    "UI - create one and bind it to a log stream. See " +
    "https://enyineer.github.io/checkstack/user-guide/guides/ship-logs/"
  );
}

/** Teardown handle for the ingest subsystem (see {@link registerIngestEndpoints}). */
export interface IngestTeardown {
  /**
   * Drain and stop the ingest subsystem: run one final flush so buffered lines
   * are persisted, stop the flush timer. Wire this
   * into the plugin's `env.registerCleanup(...)` so a graceful
   * deregister/shutdown does not silently drop the in-memory buffer. Idempotent.
   */
  stop(): Promise<void>;
  /**
   * Handler for logs forwarded THROUGH a satellite (capability kind
   * "logstream"). Registered against `satelliteCapabilityExtensionPoint` by the
   * plugin so a satellite's forwarded logs reach the SAME auth + pipeline the
   * HTTP endpoints use. Wired here because it needs the ingest area's
   * authenticator, config resolver, and pipeline.
   */
  satelliteCapabilityHandler: SatelliteCapabilityHandler;
  /**
   * The per-pod ingest pipeline. Exposed so the telemetry SINK contribution can
   * feed the SAME admit->buffer->flush path the HTTP endpoints use.
   */
  pipeline: IngestPipeline;
  /**
   * The per-stream config resolver (caps + severity rules). Exposed so the
   * telemetry sink normalizes each record against the identical stream config
   * the push endpoints resolve.
   */
  configResolver: StreamConfigResolver;
}

/**
 * Register the raw ingest HTTP handlers (OTLP/HTTP at `/v1/logs`, native
 * NDJSON/JSON at `/ingest`),
 * then start the per-pod buffer + flush worker (plan §5). The pipeline calls
 * `onIngestFlush` after each successful flush commit.
 *
 * Returns an {@link IngestTeardown} the caller MUST wire into the plugin's
 * `env.registerCleanup(...)`: the buffer is a pod-local in-memory write buffer,
 * so without a final drain on teardown the last ~500ms of buffered lines are
 * lost. The platform runs cleanup handlers on plugin deregister/shutdown.
 */
export function registerIngestEndpoints({
  rpc,
  db,
  storage,
  drain,
  recorder,
  cacheManager,
  signalService,
  logger,
  eventBus,
  verifier,
  onIngestFlush,
  onDeriveFlush,
  getReferencedPatternIds,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  drain: DrainEngine;
  recorder: ImportantEventRecorder;
  cacheManager: CacheManager;
  signalService: SignalService;
  logger: Logger;
  /**
   * Platform event bus. When provided, this pod subscribes (broadcast mode) to
   * `telemetry.push-token.invalidated` (pod-local + shared push-token caches,
   * filtered to `logstream.push`) and `logstream.patterns.changed` (pod-local
   * Drain user clusters) so token and user-pattern mutations reach this pod
   * immediately instead of waiting for the TTL / next-hydration backstops.
   */
  eventBus?: EventBus;
  /**
   * The platform push-token verifier (resolved through
   * `telemetryPushTokenVerifierRef`). Drives the ingest authenticator's token
   * lookup over the `logstream.push` source type and records push activity
   * (`recordPushSeen`) when a verified request is admitted.
   */
  verifier: PushTokenVerifier;
  /** Fast-path hook from the health integration, called post-commit. */
  onIngestFlush: OnIngestFlush;
  /** Derive tap (telemetry platform), called post-commit with the flushed
   * lines so log-to-metric / log-to-trace sources can consume them. */
  onDeriveFlush?: LogDeriveTap["onDeriveFlush"];
  /**
   * Optional resolver for the healthcheck-referenced protected pattern set,
   * supplied by the health integration. The pipeline refreshes it per stream on
   * the flush cycle so a referenced-but-quiet pattern is never re-mined under a
   * fresh id. Absent -> protection relies on `origin: 'user'` alone.
   */
  getReferencedPatternIds?: GetReferencedPatternIds;
}): IngestTeardown {
  // An operator upgrading with the removed CHECKSTACK_LOGSTREAM_SYSLOG_PORT env
  // var still set would otherwise silently lose syslog intake (it is now a
  // telemetry source instance). Warn once at setup so the misconfig is visible.
  const removedEnvWarning = removedSyslogPortEnvWarning();
  if (removedEnvWarning) logger.warn(removedEnvWarning);

  // One plugin-scoped cache (built with the API-owned convention) for token
  // verdicts (`ingest-token:<hash>`) and stream config (`stream-config:<id>`).
  // Using the API's `createIngestTokenCache` guarantees the platform's push-token
  // invalidation converges the exact scope+key this path caches under.
  const cache = createIngestTokenCache({ cacheManager });

  // The token lookup is the PLATFORM's push-token verifier, scoped to the
  // `logstream.push` source type and the `logs` signal: a presented `ckls_`
  // token resolves to its bound stream (or a revoked/unknown verdict) without
  // logstream owning any token storage.
  const auth = createIngestAuthenticator({
    lookup: createPushTokenLookup({
      verifier,
      sourceTypeId: LOGSTREAM_PUSH_SOURCE_TYPE_ID,
      signal: "logs",
    }),
    cache,
  });
  const configResolver = createStreamConfigResolver({ db, cache });

  // Stamp push activity (`lastRunAt`) when a verified request is ADMITTED (the
  // pipeline calls this only for a request whose lines were accepted). The
  // platform throttles internally (~60s/source/pod), so an unconditional call is
  // fine; fire-and-forget - a stamp failure never affects ingest.
  const recordPushSeen = (sourceId: string): void => {
    void verifier.recordPushSeen(sourceId).catch((error: unknown) => {
      logger.debug(
        `logstream: recordPushSeen failed for ${sourceId}: ${String(error)}`,
      );
    });
  };

  // The flush executor owns the offloadable stage (hydrate + classify + fold +
  // sample). Depending on CHECKSTACK_LOGSTREAM_INGEST_WORKERS it runs in-process
  // on the shared Drain tree or on a stream-sharded worker pool - the pipeline
  // and the patterns.changed consumer both use this ONE executor, so a
  // user-pattern change reaches the same tree the flush classifies against.
  const executor: FlushExecutor = createFlushExecutor({ drain, storage, logger });

  const pipeline = createIngestPipeline({
    db,
    storage,
    drain,
    executor,
    recorder,
    signalService,
    logger,
    onIngestFlush,
    recordPushSeen,
    ...(onDeriveFlush ? { onDeriveFlush } : {}),
    getReferencedPatternIds,
  });
  pipeline.start();

  rpc.registerHttpHandler(
    createOtlpLogsHandler({ auth, configResolver, pipeline, logger }),
    "/v1/logs",
  );
  rpc.registerHttpHandler(
    createNativeIngestHandler({ auth, configResolver, pipeline, logger }),
    "/ingest",
  );

  // Broadcast-mode subscriptions: EVERY pod converges its push-token caches and
  // user-pattern changes to its own pod-local state. Fire-and-forget
  // registration; a bus failure leaves the TTL / next-hydration backstops in
  // place rather than failing init.
  let unsubscribeTokenInvalidation: HookUnsubscribe | null = null;
  let unsubscribePatternsChanged: HookUnsubscribe | null = null;
  if (eventBus) {
    void eventBus
      .subscribe(
        pluginMetadata.pluginId,
        telemetryPushTokenInvalidatedHook,
        async (payload: TelemetryPushTokenInvalidatedPayload) => {
          // Filter to OUR push source type: a foreign push type's token event
          // never touches this plugin's ingest caches.
          if (payload.sourceTypeId !== LOGSTREAM_PUSH_SOURCE_TYPE_ID) return;
          await applyPushTokenInvalidation({ payload, auth, cache });
        },
        { mode: "broadcast" },
      )
      .then((unsubscribe: HookUnsubscribe) => {
        unsubscribeTokenInvalidation = unsubscribe;
      })
      .catch((error: unknown) => {
        logger.warn(
          `logstream: failed to subscribe to push-token invalidations (falling back to TTLs): ${String(error)}`,
        );
      });

    void eventBus
      .subscribe(
        pluginMetadata.pluginId,
        logstreamPatternsChangedHook,
        async (payload: LogstreamPatternsChangedPayload) => {
          applyPatternsChanged({ payload, executor });
        },
        { mode: "broadcast" },
      )
      .then((unsubscribe: HookUnsubscribe) => {
        unsubscribePatternsChanged = unsubscribe;
      })
      .catch((error: unknown) => {
        logger.warn(
          `logstream: failed to subscribe to pattern changes (falling back to hydration): ${String(error)}`,
        );
      });
  }

  const satelliteCapabilityHandler =
    createLogstreamSatelliteCapabilityHandler({
      db,
      auth,
      configResolver,
      pipeline,
      logger,
    });

  let stopped = false;
  return {
    satelliteCapabilityHandler,
    pipeline,
    configResolver,
    async stop() {
      if (stopped) return;
      stopped = true;
      // Final drain so the last buffered lines are persisted, then stop the
      // timer.
      try {
        await pipeline.flushNow();
      } catch (error) {
        logger.warn(`logstream: final flush on teardown failed: ${String(error)}`);
      }
      pipeline.stop();
      // Drain + terminate the executor AFTER the final flush (no-op in-process;
      // the worker pool runs each worker's final flush and terminates them).
      try {
        await executor.stop();
      } catch (error) {
        logger.warn(`logstream: executor stop on teardown failed: ${String(error)}`);
      }
      try {
        await unsubscribeTokenInvalidation?.();
      } catch (error) {
        logger.debug(
          `logstream: token-invalidation unsubscribe failed: ${String(error)}`,
        );
      }
      try {
        await unsubscribePatternsChanged?.();
      } catch (error) {
        logger.debug(
          `logstream: patterns-changed unsubscribe failed: ${String(error)}`,
        );
      }
    },
  };
}
