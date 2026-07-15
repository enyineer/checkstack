/**
 * Ingest SEAM: the OTLP + native span push endpoints, `cktr_` push-token auth,
 * and the shared per-pod pipeline that folds spans into the storage ports
 * (spans, summaries, op buckets, service/op catalog, activity) and records cap /
 * rate-limit important events. `index.ts` already hands this function its full
 * dependency set, so this wave only edits THIS file.
 *
 * PUSH-TOKEN AUTH (platform-owned). Tracestream no longer owns a token table:
 * the telemetry platform mints/rotates/revokes each `tracestream.push`
 * instance's bearer token and stores only its hash. The authenticator verifies
 * presented tokens through the platform's push-token verifier
 * (`createTracestreamPushTokenLookup` over `telemetryPushTokenVerifierRef`).
 * Every verified ingest stamps the source's last-seen through the same verifier
 * (throttled, fire-and-forget).
 *
 * The returned {@link IngestHandle} exposes the `pipeline` + `configResolver` so
 * the TELEMETRY SINK contribution can feed the SAME admit -> buffer -> flush path
 * the HTTP endpoints use (parity). The sink itself is registered by `index.ts`.
 */

import type {
  SafeDatabase,
  Logger,
  RpcService,
  EventBus,
  HookUnsubscribe,
  InstanceRuntime,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import type { SignalService } from "@checkstack/signal-common";
import type { QueueManager } from "@checkstack/queue-api";
import {
  createIngestAuthenticator,
  createIngestTokenCache,
  ingestTokenCacheKey,
  ingestTokenMissKey,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import {
  telemetryPushTokenInvalidatedHook,
  type PushTokenVerifier,
  type TelemetryPushTokenInvalidatedPayload,
} from "@checkstack/telemetry-backend";
import { pluginMetadata } from "@checkstack/tracestream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { OnIngestFlush } from "../health/setup";
import { tokenKit } from "../token-crypto";
import { createTracestreamPushTokenLookup } from "./token-lookup";
import { TRACESTREAM_PUSH_SOURCE_TYPE_ID } from "./push-source-type";
import { createStreamConfigResolver, type StreamConfigResolver } from "./stream-config";
import { createIngestPipeline, type IngestPipeline } from "./pipeline";
import { createOtlpTracesHandler } from "./endpoints/otlp";
import { createNativeTracesHandler } from "./endpoints/native";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import { createTracestreamSatelliteCapabilityHandler } from "../satellite/handler";

export interface RegisterIngestDeps {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  recorder: ImportantEventRecorder;
  rpc: RpcService;
  cacheManager: CacheManager;
  signalService: SignalService;
  queueManager: QueueManager;
  eventBus: EventBus;
  instanceRuntime: InstanceRuntime;
  /**
   * Platform push-token verifier (resolved via `telemetryPushTokenVerifierRef`):
   * the ingest authenticator verifies `cktr_` tokens through it, and each
   * verified ingest stamps last-seen with `recordPushSeen`.
   */
  verifier: PushTokenVerifier;
  logger: Logger;
  /** Post-commit health fast-path hook, threaded into the pipeline. */
  onIngestFlush?: OnIngestFlush;
}

/** Handle wired into `env.registerCleanup` (final flush + timer teardown). */
export interface IngestHandle {
  stop(): Promise<void>;
  /**
   * The per-pod ingest pipeline. Exposed so the telemetry SINK contribution can
   * feed the SAME admit -> buffer -> flush path the HTTP endpoints use.
   */
  pipeline: IngestPipeline;
  /**
   * The per-stream config resolver (caps + rate limit + sampling). Exposed so the
   * telemetry sink normalizes each span against the identical stream config the
   * push endpoints resolve.
   */
  configResolver: StreamConfigResolver;
  /** Push-token authenticator (cktr_), for any future forwarded-ingest path. */
  auth: IngestAuthenticator;
  /**
   * The "tracestream" satellite capability handler (spans forwarded through a
   * satellite re-enter the SAME auth + pipeline as direct pushes). Registered
   * against the satellite capability extension point in `index.ts`.
   */
  satelliteCapabilityHandler: SatelliteCapabilityHandler;
}

/**
 * Apply a `telemetry.push-token.invalidated` broadcast to this pod's ingest-auth
 * caches for a `tracestream.push` token. The caller filters on `sourceTypeId`;
 * this only handles the two reasons. Exported for unit testing.
 *
 * - `minted`: clear this pod's negative (unknown-token) LRU + the shared miss
 *   marker (`auth.clearNegative`), so a freshly-minted token authenticates
 *   without waiting out the negative TTL instead of being shadowed by a pod's
 *   stale miss.
 * - `revoked`: delete the shared POSITIVE verdict key AND the miss marker, so
 *   the token stops authenticating on every pod at once and a later re-mint is
 *   not blocked by a stale miss.
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
  const { tokenHash } = payload;
  if (payload.reason === "minted") {
    await auth.clearNegative?.(tokenHash);
    return;
  }
  // revoked: the positive verdict lives only in the shared cache (no pod-local
  // positive LRU), so a shared delete reaches every pod at once.
  try {
    await cache.provider.delete(ingestTokenCacheKey(tokenHash));
  } catch {
    // best-effort; the 60s positive TTL bounds the stale window.
  }
  try {
    await cache.provider.delete(ingestTokenMissKey(tokenHash));
  } catch {
    // best-effort; the short negative TTL is the robust guarantee.
  }
}

/**
 * Build the ingest subsystem: the cktr_ push-token authenticator (shared-cache
 * verdict + per-pod negative cache), the per-stream config resolver, and the
 * pod-local pipeline (buffer + single-inflight flush loop). Registers the OTLP
 * and native HTTP handlers at the exact paths the push source type advertises
 * (`/api/tracestream/v1/traces`, `/api/tracestream/ingest`).
 *
 * Subscribes (broadcast mode) to the platform's push-token invalidation hook so
 * a mint/rotate/revoke on ANY pod converges this pod's ingest-auth caches. This
 * is NEW wiring: tracestream previously had no invalidation bus subscription, so
 * a freshly-minted token could be shadowed by another pod's negative LRU for up
 * to the negative TTL - the "minted" branch fixes that gap.
 */
export function registerIngest(deps: RegisterIngestDeps): IngestHandle {
  const {
    db,
    storage,
    recorder,
    rpc,
    cacheManager,
    signalService,
    eventBus,
    verifier,
    logger,
    onIngestFlush,
  } = deps;

  const cache = createIngestTokenCache({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
  });
  const auth = createIngestAuthenticator({
    lookup: createTracestreamPushTokenLookup({ verifier }),
    cache,
    hashToken: tokenKit.hashToken,
  });

  // Verified ingest stamps the source's last-seen (throttled + fire-and-forget
  // inside the verifier). `tokenId` is the push source instance id.
  const recordSeen = (tokenId: string): void => {
    void verifier.recordPushSeen(tokenId);
  };

  const configResolver = createStreamConfigResolver({ db, cache });

  const pipeline = createIngestPipeline({
    storage,
    recorder,
    signalService,
    logger,
    ...(onIngestFlush ? { onIngestFlush } : {}),
  });
  pipeline.start();

  rpc.registerHttpHandler(
    createOtlpTracesHandler({ auth, configResolver, pipeline, recordSeen, logger }),
    "/v1/traces",
  );
  rpc.registerHttpHandler(
    createNativeTracesHandler({ auth, configResolver, pipeline, recordSeen, logger }),
    "/ingest",
  );

  const satelliteCapabilityHandler = createTracestreamSatelliteCapabilityHandler({
    auth,
    configResolver,
    pipeline,
    activity: storage.activity,
    recordSeen,
    logger,
  });

  // Broadcast-mode subscription: EVERY pod applies push-token invalidations to
  // its own ingest-auth caches. Fire-and-forget registration; a bus failure
  // leaves the TTL backstops in place rather than failing init.
  let unsubscribeInvalidation: HookUnsubscribe | null = null;
  void eventBus
    .subscribe(
      pluginMetadata.pluginId,
      telemetryPushTokenInvalidatedHook,
      async (payload: TelemetryPushTokenInvalidatedPayload) => {
        if (payload.sourceTypeId !== TRACESTREAM_PUSH_SOURCE_TYPE_ID) return;
        await applyPushTokenInvalidation({ payload, auth, cache });
      },
      { mode: "broadcast" },
    )
    .then((unsubscribe: HookUnsubscribe) => {
      unsubscribeInvalidation = unsubscribe;
    })
    .catch((error: unknown) => {
      logger.warn(
        `tracestream: failed to subscribe to push-token invalidations (falling back to TTLs): ${String(error)}`,
      );
    });

  let stopped = false;
  return {
    pipeline,
    configResolver,
    auth,
    satelliteCapabilityHandler,
    async stop() {
      if (stopped) return;
      stopped = true;
      // Final drain so the last buffered spans are persisted, then stop the timer.
      try {
        await pipeline.flushNow();
      } catch (error) {
        logger.warn(`tracestream: final flush on teardown failed: ${String(error)}`);
      }
      pipeline.stop();
      try {
        await unsubscribeInvalidation?.();
      } catch (error) {
        logger.debug(
          `tracestream: push-token invalidation unsubscribe failed: ${String(error)}`,
        );
      }
    },
  };
}
