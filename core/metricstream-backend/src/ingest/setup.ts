import type {
  SafeDatabase,
  Logger,
  InstanceRuntime,
  RpcService,
  EventBus,
  HookUnsubscribe,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  createSourceTokenKit,
  createIngestAuthenticator,
  createIngestTokenCache,
  IngestBuffer,
  createFlushLoop,
  type IngestAuthenticator,
  type SourceTokenKit,
} from "@checkstack/ingest-utils";
import {
  pluginMetadata,
  METRICSTREAM_TOKEN_PREFIX,
} from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { MetricIngestSink } from "../sources/extension-point";
import {
  metricstreamTokensInvalidatedHook,
  type MetricstreamTokensInvalidatedPayload,
} from "../events/bus-hooks";
import {
  createMetricSink,
  estimateDatapointBytes,
  type BufferedDatapoint,
} from "./sink";
import { lookupTokenByHash } from "./token-lookup";
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
  /** Source-token authenticator (ckms_) for push sources' HTTP handlers. */
  auth: IngestAuthenticator;
  /** The token kit (ckms_) - mint path + hashing for the API area. */
  tokenKit: SourceTokenKit;
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
 * Build the shared ingest subsystem: the ckms_ source-token kit, the token
 * authenticator (shared-cache verdict + per-pod negative cache), the per-stream
 * config resolver, the pod-local buffer, and the single-inflight flush loop
 * whose `runCycle` folds each stream's drained datapoints into storage in ONE
 * transaction. Also subscribes (broadcast mode) to
 * `metricstream.tokens.invalidated` so a token MINTED on another pod clears this
 * pod's negative (unknown-token) cache and authenticates without waiting out the
 * negative TTL.
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
  eventBus?: EventBus;
}): IngestTeardown {
  const tokenKit = createSourceTokenKit({ prefix: METRICSTREAM_TOKEN_PREFIX });

  const cache = createIngestTokenCache({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
  });
  const auth = createIngestAuthenticator({
    lookup: (tokenHash) => lookupTokenByHash({ db, tokenHash }),
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

  // Broadcast-mode subscription: EVERY pod clears its per-pod negative
  // (unknown-token) cache when a token is minted, so a token minted on another
  // pod authenticates here without waiting out the negative TTL. The
  // revoked/stream_deleted paths are served by the shared-cache delete the API
  // performs (no per-connection state to evict - metricstream is HTTP push
  // only), so only `minted` needs local action.
  let unsubscribeTokenInvalidation: HookUnsubscribe | null = null;
  if (eventBus) {
    void eventBus
      .subscribe(
        pluginMetadata.pluginId,
        metricstreamTokensInvalidatedHook,
        async (payload: MetricstreamTokensInvalidatedPayload) => {
          await applyTokenInvalidation({ payload, auth });
        },
        { mode: "broadcast" },
      )
      .then((unsubscribe: HookUnsubscribe) => {
        unsubscribeTokenInvalidation = unsubscribe;
      })
      .catch((error: unknown) => {
        logger.warn(
          `metricstream: failed to subscribe to token invalidations (falling back to TTLs): ${String(error)}`,
        );
      });
  }

  let stopped = false;
  return {
    sink,
    auth,
    tokenKit,
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
 * Apply a `metricstream.tokens.invalidated` broadcast to this pod's per-pod
 * negative token cache. Only `minted` requires action (clear the negative cache
 * for the fresh hashes); `revoked`/`stream_deleted` are handled by the API's
 * shared-cache delete. Exported for unit testing.
 */
export async function applyTokenInvalidation({
  payload,
  auth,
}: {
  payload: MetricstreamTokensInvalidatedPayload;
  auth: IngestAuthenticator;
}): Promise<void> {
  if (payload.reason !== "minted") return;
  for (const hash of payload.tokenHashes) {
    await auth.clearNegative?.(hash);
  }
}
