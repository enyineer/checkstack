import type {
  SafeDatabase,
  Logger,
  InstanceRuntime,
  HealthCheckRegistry,
  CollectorRegistry,
  RpcService,
  RpcClient,
} from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { SignalService } from "@checkstack/signal-common";
import type { SeverityBand } from "@checkstack/logstream-common";
import { createCachedScope } from "@checkstack/cache-utils";
import { pluginMetadata } from "@checkstack/logstream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { LogStreamHealthStrategy } from "./strategy";
import { WindowMetricsCollector } from "./window-metrics-collector";
import { PatternOccurrenceCollector } from "./pattern-occurrence-collector";
import { PatternMetricCollector } from "./pattern-metric-collector";
import {
  createFastPath,
  createHealthcheckAssignmentResolver,
  type EnqueueRun,
} from "./fast-path";
import {
  createReferencedPatternResolver,
  type ResolveReferencedPatternIds,
} from "./pattern-references";
import { registerMaintenanceJobs } from "./maintenance";
import { HEALTH_CHECK_QUEUE, type LogStreamRunJobPayload } from "./constants";

/**
 * Post-commit summary the ingest flush hands to the health fast-path. When
 * `worstBand >= error`, the health integration enqueues a debounced one-off
 * evaluation for every assignment referencing the stream (plan §7).
 */
export interface IngestFlushInfo {
  streamId: string;
  worstBand: SeverityBand;
  /** error+fatal lines committed in this flush. */
  errorDelta: number;
}

/** The fast-path hook the ingest pipeline calls after each successful flush. */
export type OnIngestFlush = (info: IngestFlushInfo) => void | Promise<void>;

export interface HealthIntegration {
  onIngestFlush: OnIngestFlush;
  /**
   * Resolve the pattern ids a stream's health checks reference (a
   * `pattern-occurrence` / `pattern-metric` collector's `patternId`). The ingest
   * area calls this per stream to feed the Drain engine's protected set (so a
   * still-referenced but quiet pattern is never re-mined under a fresh id), and
   * retention uses it to spare referenced patterns. Returns `[]` when the
   * cross-plugin RPC client is unavailable (fast-path disabled).
   */
  getReferencedPatternIds: ResolveReferencedPatternIds;
  /**
   * Schedule the recurring silence/rollup/retention jobs. Call from the
   * plugin's `afterPluginsReady` phase, NOT init: the retention pass resolves
   * healthcheck-referenced patterns over cross-plugin RPC, and an overdue job
   * firing during boot would 404 against a not-yet-registered healthcheck
   * router (harmlessly skipping the sweep, but wasting the run and logging a
   * warning). Rejections are logged, never thrown.
   */
  startMaintenance: () => Promise<void>;
}

/**
 * Register the `logstream` health strategy + collectors, the fast-path
 * evaluation trigger, and the silence/retention maintenance jobs. Returns the
 * fast-path hook for the ingest pipeline to invoke post-commit.
 *
 * Synchronous (index.ts consumes the return value directly): the strategy /
 * collector registration is immediate, while the recurring maintenance jobs are
 * scheduled fire-and-forget so a transient queue hiccup can never fail plugin
 * init.
 *
 * `rpcClient` is OPTIONAL: the fast-path enumerates healthcheck configs +
 * assignments via the sanctioned cross-plugin RPC client. Until index.ts wires
 * `coreServices.rpcClient` in, the fast-path is a no-op (the scheduled tick
 * still evaluates every stream); the strategy, collectors and maintenance jobs
 * all work regardless.
 */
export function registerHealthIntegration({
  db,
  storage,
  recorder,
  queueManager,
  cacheManager,
  logger,
  healthCheckRegistry,
  collectorRegistry,
  rpcClient,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  recorder: ImportantEventRecorder;
  queueManager: QueueManager;
  cacheManager: CacheManager;
  signalService: SignalService;
  logger: Logger;
  instanceRuntime: InstanceRuntime;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  rpcClient?: RpcClient;
}): HealthIntegration {
  // 1. Strategy + collectors (immediate).
  healthCheckRegistry.register(new LogStreamHealthStrategy({ db, storage }));
  collectorRegistry.register(new WindowMetricsCollector());
  collectorRegistry.register(new PatternOccurrenceCollector());
  collectorRegistry.register(new PatternMetricCollector());

  // The referenced-pattern resolver requires the cross-plugin RPC client (it
  // enumerates health-check configs). Without it, referenced-pattern protection
  // is a no-op (returns []) - user-origin protection still holds unconditionally,
  // and the scheduled retention simply cannot spare a quiet REFERENCED pattern.
  const getReferencedPatternIds: ResolveReferencedPatternIds = rpcClient
    ? createReferencedPatternResolver({
        rpcClient,
        cache: createCachedScope({
          cacheManager,
          pluginId: pluginMetadata.pluginId,
          defaultTtlMs: 60_000,
        }),
      })
    : async () => [];

  // 2. Recurring maintenance (silence + rollup + retention), DEFERRED to the
  // afterPluginsReady phase (see HealthIntegration.startMaintenance): retention
  // consults `getReferencedPatternIds` over cross-plugin RPC, which is only
  // guaranteed routable once every plugin has initialized.
  const startMaintenance = async (): Promise<void> => {
    try {
      await registerMaintenanceJobs({
        queueManager,
        db,
        storage,
        recorder,
        logger,
        getReferencedPatternIds,
      });
    } catch (error) {
      logger.error(
        `logstream: failed to schedule maintenance jobs: ${String(error)}`,
      );
    }
  };

  // 3. Fast-path evaluation trigger. Requires the cross-plugin RPC client.
  if (!rpcClient) {
    logger.warn(
      "logstream: rpcClient not provided; fast-path health evaluation disabled (scheduled ticks still run).",
    );
    return {
      onIngestFlush() {},
      getReferencedPatternIds,
      startMaintenance,
    };
  }

  const cache = createCachedScope({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
    defaultTtlMs: 60_000,
  });
  const resolveAssignments = createHealthcheckAssignmentResolver({
    rpcClient,
    cache,
  });
  const healthQueue = queueManager.getQueue<LogStreamRunJobPayload>(
    HEALTH_CHECK_QUEUE,
  );
  const enqueueRun: EnqueueRun = async ({ payload, jobId }) => {
    await healthQueue.enqueue(payload, { jobId });
  };
  const onIngestFlush = createFastPath({
    resolveAssignments,
    enqueueRun,
    logger,
  });

  return { onIngestFlush, getReferencedPatternIds, startMaintenance };
}
