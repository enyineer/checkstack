import type {
  SafeDatabase,
  Logger,
  InstanceRuntime,
  RpcService,
  EventBus,
  HookUnsubscribe,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import type { SignalService } from "@checkstack/signal-common";
import {
  createSourceTokenKit,
  createIngestAuthenticator,
  createIngestTokenCache,
  ingestTokenCacheKey,
  ingestTokenMissKey,
  IngestBuffer,
  createFlushLoop,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import {
  pluginMetadata,
  METRICSTREAM_TOKEN_PREFIX,
} from "@checkstack/metricstream-common";
import {
  telemetryPushTokenInvalidatedHook,
  type PushTokenVerifier,
  type TelemetryPushTokenInvalidatedPayload,
} from "@checkstack/telemetry-backend";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { MetricIngestSink } from "../sources/ingest-sink";
import { METRICSTREAM_PUSH_QUALIFIED_ID } from "../sources/push/source-type";
import {
  createMetricSink,
  estimateDatapointBytes,
  type BufferedDatapoint,
} from "./sink";
import { createMetricstreamPushTokenLookup } from "./token-lookup";
import { createStreamConfigResolver, type StreamConfigResolver } from "./stream-config";
import { createMetricFlusher } from "./flush";

/** Timer period between automatic flush cycles. */
export const FLUSH_INTERVAL_MS = 500;
/** Datapoint count that triggers an immediate (size-based) flush. */
export const FLUSH_THRESHOLD = 5000;

/** Handle returned by {@link registerIngest} (wire `stop` into cleanup). */
export interface IngestTeardown {
  /** The shared write path both source kinds use. */
  sink: MetricIngestSink;
  /** Push-token authenticator (ckms_) for the push endpoints' HTTP handlers. */
  auth: IngestAuthenticator;
  /**
   * Per-stream config resolver (caps + soft limit), cached. Push endpoints use
   * it for the per-request datapoint cap + soft rate limit; the flush uses it
   * for the cardinality cap.
   */
  configResolver: StreamConfigResolver;
  /**
   * Drain + stop the ingest subsystem: final flush so buffered datapoints are
   * persisted, stop the flush timer, unsubscribe the bus hook. Idempotent.
   */
  stop(): Promise<void>;
}

/**
 * Build the shared ingest subsystem: the token authenticator (shared-cache
 * verdict + per-pod negative cache) over the PLATFORM push-token verifier, the
 * per-stream config resolver, the pod-local buffer, and the single-inflight
 * flush loop whose `runCycle` folds each stream's drained datapoints into storage
 * in ONE transaction. Also subscribes (broadcast mode) to the platform's
 * `telemetry.push-token.invalidated` hook so that, for `metricstream.push`
 * tokens, a REVOKE drops this pod's cached positive verdict + miss marker and a
 * MINT clears its negative (unknown-token) cache - each pod converges without
 * waiting out a TTL.
 *
 * STATE & SCALE: the buffer + flush state are pod-local, short-lived write
 * bookkeeping - never a queryable source of truth. Each pod folds its own intake
 * into the shared Postgres tables; a durable read is identical on every pod.
 */
export function registerIngest({
  db,
  storage,
  recorder,
  cacheManager,
  signalService,
  logger,
  verifier,
  eventBus,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  recorder: ImportantEventRecorder;
  cacheManager: CacheManager;
  signalService: SignalService;
  logger: Logger;
  instanceRuntime: InstanceRuntime;
  /** Platform push-token verifier backing the ingest authenticator. */
  verifier: PushTokenVerifier;
  eventBus?: EventBus;
}): IngestTeardown {
  // The kit only supplies `hashToken` here (mint/list/revoke are the platform's);
  // the prefix keeps the sha256 convention identical to the historical tokens.
  const tokenKit = createSourceTokenKit({ prefix: METRICSTREAM_TOKEN_PREFIX });

  const cache = createIngestTokenCache({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
  });
  const auth = createIngestAuthenticator({
    lookup: createMetricstreamPushTokenLookup({ verifier }),
    cache,
    hashToken: tokenKit.hashToken,
  });

  const configResolver = createStreamConfigResolver({ db, cache });

  const buffer = new IngestBuffer<BufferedDatapoint>({
    estimateBytes: estimateDatapointBytes,
  });

  const flusher = createMetricFlusher({
    db,
    storage,
    recorder,
    signalService,
    configResolver,
    logger,
    flushIntervalMs: FLUSH_INTERVAL_MS,
  });

  const flushLoop = createFlushLoop({
    intervalMs: FLUSH_INTERVAL_MS,
    runCycle: async () => {
      const drained = buffer.drain();
      if (drained.size === 0) return;
      await flusher.flushDrained(drained);
    },
  });
  flushLoop.start();

  const sink = createMetricSink({
    buffer,
    flushLoop,
    flushThreshold: FLUSH_THRESHOLD,
  });

  // Broadcast-mode subscription to the platform push-token lifecycle hook. Every
  // pod converges its ingest-auth caches: a REVOKE (disable/rotate-old/delete)
  // drops the shared positive verdict + miss marker so the token stops
  // authenticating within the TTL; a MINT (create/rotate-new/enable) clears the
  // per-pod negative cache so the fresh token authenticates immediately. Filtered
  // to metricstream's OWN push type - a hash of another push type is ignored.
  let unsubscribeTokenInvalidation: HookUnsubscribe | null = null;
  if (eventBus) {
    void eventBus
      .subscribe(
        pluginMetadata.pluginId,
        telemetryPushTokenInvalidatedHook,
        async (payload: TelemetryPushTokenInvalidatedPayload) => {
          await applyPushTokenInvalidation({ payload, auth, cache });
        },
        { mode: "broadcast" },
      )
      .then((unsubscribe: HookUnsubscribe) => {
        unsubscribeTokenInvalidation = unsubscribe;
      })
      .catch((error: unknown) => {
        logger.warn(
          `metricstream: failed to subscribe to push-token invalidations (falling back to TTLs): ${String(error)}`,
        );
      });
  }

  let stopped = false;
  return {
    sink,
    auth,
    configResolver,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await flushLoop.flushNow();
      } catch (error) {
        logger.warn(
          `metricstream: final flush on teardown failed: ${String(error)}`,
        );
      }
      flushLoop.stop();
      try {
        await unsubscribeTokenInvalidation?.();
      } catch (error) {
        logger.debug(
          `metricstream: token-invalidation unsubscribe failed: ${String(error)}`,
        );
      }
    },
  };
}

/**
 * Apply a platform `telemetry.push-token.invalidated` broadcast to this pod's
 * ingest-auth caches. Scoped to metricstream's push type (a hash of another push
 * type is ignored). `revoked` drops the shared positive verdict AND the negative
 * miss marker for the hash so the token stops authenticating within the TTL;
 * `minted` clears the per-pod negative cache + shared miss marker (via
 * `clearNegative`) so a freshly-minted token authenticates without waiting out
 * the negative TTL. Exported for unit testing.
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
  if (payload.sourceTypeId !== METRICSTREAM_PUSH_QUALIFIED_ID) return;
  const { tokenHash } = payload;
  if (payload.reason === "revoked") {
    await cache.invalidate(ingestTokenCacheKey(tokenHash));
    await cache.provider.delete(ingestTokenMissKey(tokenHash));
    return;
  }
  // "minted": clearNegative drops this pod's negative LRU AND the shared miss
  // marker for the hash.
  await auth.clearNegative?.(tokenHash);
}
