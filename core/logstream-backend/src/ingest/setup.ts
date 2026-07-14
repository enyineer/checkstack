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
import { pluginMetadata } from "@checkstack/logstream-common";
import { createIngestTokenCache } from "../api/token-cache";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { DrainEngine } from "../drain/engine";
import type { ImportantEventRecorder } from "../events/recorder";
import type { OnIngestFlush } from "../health/setup";
import {
  logstreamTokensInvalidatedHook,
  logstreamPatternsChangedHook,
  type LogstreamTokensInvalidatedPayload,
  type LogstreamPatternsChangedPayload,
} from "../events/bus-hooks";
import { createIngestAuthenticator, type IngestAuthenticator } from "./auth";
import { lookupTokenByHash } from "./token-lookup";
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
import {
  createSyslogListener,
  readSyslogEnvConfig,
  type SyslogListener,
} from "./syslog/listener";
import { createLogstreamSatelliteCapabilityHandler } from "./satellite-handler";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";

/**
 * Apply a `logstream.tokens.invalidated` broadcast to this pod's POD-LOCAL
 * token state (the shared-cache invalidation the API performs cannot reach
 * these). Exported for unit testing.
 *
 * - `revoked` / `stream_deleted`: evict positive per-connection syslog
 *   verdicts so an already-open connection stops ingesting immediately.
 * - `minted`: clear the in-process negative (unknown-token) cache for the new
 *   hashes and evict negative syslog verdicts, so the fresh token
 *   authenticates without waiting out a TTL.
 */
export async function applyTokenInvalidation({
  payload,
  auth,
  listener,
}: {
  payload: LogstreamTokensInvalidatedPayload;
  auth: IngestAuthenticator;
  listener: SyslogListener | null;
}): Promise<void> {
  if (payload.reason === "minted") {
    for (const hash of payload.tokenHashes) {
      await auth.clearNegative?.(hash);
    }
    listener?.invalidateVerdicts({ negatives: true });
    return;
  }
  listener?.invalidateVerdicts({ tokenIds: payload.tokenIds });
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

/** Teardown handle for the ingest subsystem (see {@link registerIngestEndpoints}). */
export interface IngestTeardown {
  /**
   * Drain and stop the ingest subsystem: run one final flush so buffered lines
   * are persisted, stop the flush timer, and stop the syslog listener. Wire this
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
 * NDJSON/JSON at `/ingest`) and, when configured, the syslog TCP/TLS listener,
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
  instanceRuntime,
  eventBus,
  onIngestFlush,
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
  instanceRuntime: InstanceRuntime;
  /**
   * Platform event bus. When provided, this pod subscribes (broadcast mode) to
   * `logstream.tokens.invalidated` (pod-local token state) and
   * `logstream.patterns.changed` (pod-local Drain user clusters) so token and
   * user-pattern mutations reach this pod immediately instead of waiting for the
   * TTL / next-hydration backstops.
   */
  eventBus?: EventBus;
  /** Fast-path hook from the health integration, called post-commit. */
  onIngestFlush: OnIngestFlush;
  /**
   * Optional resolver for the healthcheck-referenced protected pattern set,
   * supplied by the health integration. The pipeline refreshes it per stream on
   * the flush cycle so a referenced-but-quiet pattern is never re-mined under a
   * fresh id. Absent -> protection relies on `origin: 'user'` alone.
   */
  getReferencedPatternIds?: GetReferencedPatternIds;
}): IngestTeardown {
  // One plugin-scoped cache (built with the API-owned convention) for token
  // verdicts (`ingest-token:<hash>`) and stream config (`stream-config:<id>`).
  // Using the API's `createIngestTokenCache` guarantees the revoke path
  // invalidates the exact scope+key this path caches under.
  const cache = createIngestTokenCache({ cacheManager });

  const auth = createIngestAuthenticator({
    lookup: (tokenHash) => lookupTokenByHash({ db, tokenHash }),
    cache,
  });
  const configResolver = createStreamConfigResolver({ db, cache });

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

  const syslogConfig = readSyslogEnvConfig();
  let listener: SyslogListener | null = null;
  if (syslogConfig) {
    listener = createSyslogListener({
      config: syslogConfig,
      auth,
      configResolver,
      pipeline,
      logger,
      instanceRuntime,
    });
    listener.start();
  } else {
    logger.debug(
      "logstream: syslog listener disabled (CHECKSTACK_LOGSTREAM_SYSLOG_PORT unset)",
    );
  }

  // Broadcast-mode subscriptions: EVERY pod applies token invalidations and
  // user-pattern changes to its own pod-local state. Fire-and-forget
  // registration; a bus failure leaves the TTL / next-hydration backstops in
  // place rather than failing init.
  let unsubscribeTokenInvalidation: HookUnsubscribe | null = null;
  let unsubscribePatternsChanged: HookUnsubscribe | null = null;
  if (eventBus) {
    void eventBus
      .subscribe(
        pluginMetadata.pluginId,
        logstreamTokensInvalidatedHook,
        async (payload: LogstreamTokensInvalidatedPayload) => {
          await applyTokenInvalidation({ payload, auth, listener });
        },
        { mode: "broadcast" },
      )
      .then((unsubscribe: HookUnsubscribe) => {
        unsubscribeTokenInvalidation = unsubscribe;
      })
      .catch((error: unknown) => {
        logger.warn(
          `logstream: failed to subscribe to token invalidations (falling back to TTLs): ${String(error)}`,
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
      // timer and the syslog listener.
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
      listener?.stop();
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
