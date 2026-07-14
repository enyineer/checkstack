/**
 * Ingest SEAM (task #21): the OTLP + native span push endpoints, `cktr_`
 * source-token auth, and the shared per-pod pipeline that folds spans into the
 * storage ports (spans, summaries, op buckets, service/op catalog, activity) and
 * records cap / rate-limit important events. `index.ts` already hands this
 * function its full dependency set, so this wave only edits THIS file.
 *
 * The returned {@link IngestHandle} exposes the `pipeline` + `configResolver` so
 * the TELEMETRY SINK contribution can feed the SAME admit -> buffer -> flush path
 * the HTTP endpoints use (parity). The sink itself is registered by `index.ts`
 * (which holds the telemetry extension-point handle and `coreServices.auth`),
 * consuming this handle.
 */

import type {
  SafeDatabase,
  Logger,
  RpcService,
  EventBus,
  InstanceRuntime,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { SignalService } from "@checkstack/signal-common";
import type { QueueManager } from "@checkstack/queue-api";
import {
  createIngestAuthenticator,
  createIngestTokenCache,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import { pluginMetadata } from "@checkstack/tracestream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { tokenKit } from "../token-crypto";
import { lookupTokenByHash } from "./token-lookup";
import { createStreamConfigResolver, type StreamConfigResolver } from "./stream-config";
import { createIngestPipeline, type IngestPipeline } from "./pipeline";
import { createOtlpTracesHandler } from "./endpoints/otlp";
import { createNativeTracesHandler } from "./endpoints/native";

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
  logger: Logger;
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
  /** Source-token authenticator (cktr_), for any future forwarded-ingest path. */
  auth: IngestAuthenticator;
}

/**
 * Build the ingest subsystem: the cktr_ token authenticator (shared-cache verdict
 * + per-pod negative cache; the API's revoke path deletes the SAME
 * `ingest-token:<hash>` key), the per-stream config resolver, and the pod-local
 * pipeline (buffer + single-inflight flush loop). Registers the OTLP and native
 * HTTP handlers at the exact paths the frontend's ship-traces snippets print
 * (`/api/tracestream/v1/traces`, `/api/tracestream/ingest`).
 *
 * No token-invalidation bus subscription (unlike metricstream): the API's
 * shared-cache delete on revoke reaches every pod, and the 30s negative-cache TTL
 * is the backstop for a freshly-minted token - tracestream has no per-connection
 * ingest state (HTTP push only) that a broadcast would need to evict.
 */
export function registerIngest(deps: RegisterIngestDeps): IngestHandle {
  const { db, storage, recorder, rpc, cacheManager, signalService, logger } = deps;

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

  const pipeline = createIngestPipeline({
    storage,
    recorder,
    signalService,
    logger,
  });
  pipeline.start();

  rpc.registerHttpHandler(
    createOtlpTracesHandler({ auth, configResolver, pipeline, logger }),
    "/v1/traces",
  );
  rpc.registerHttpHandler(
    createNativeTracesHandler({ auth, configResolver, pipeline, logger }),
    "/ingest",
  );

  let stopped = false;
  return {
    pipeline,
    configResolver,
    auth,
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
    },
  };
}
