/**
 * Register the `tracestream` health strategy + collectors and the fast-path
 * evaluation trigger. Returns the fast-path hook the ingest pipeline invokes
 * post-commit. Mirrors logstream's `health/setup.ts` (tracestream has no
 * healthcheck-referenced protected-pattern set, so there is no maintenance seam
 * here - the plugin's own maintenance is registered separately in index.ts).
 */

import type {
  Logger,
  HealthCheckRegistry,
  CollectorRegistry,
  RpcClient,
} from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { CacheManager } from "@checkstack/cache-api";
import { createCachedScope } from "@checkstack/cache-utils";
import {
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "@checkstack/tracestream-common";
import type { Storage } from "../storage";
import { TraceStreamHealthStrategy } from "./strategy";
import { TraceWindowCollector } from "./window-collector";
import { OperationLatencyCollector } from "./operation-latency-collector";
import {
  createFastPath,
  createHealthcheckAssignmentResolver,
  type EnqueueRun,
} from "./fast-path";

/**
 * Post-commit summary the ingest flush hands to the health fast-path. When
 * `errorSpanCount > 0`, the health integration enqueues a debounced one-off
 * evaluation for every assignment referencing the stream.
 */
export interface IngestFlushInfo {
  streamId: string;
  /** Error spans committed in this flush. */
  errorSpanCount: number;
}

/** The fast-path hook the ingest pipeline calls after each successful flush. */
export type OnIngestFlush = (info: IngestFlushInfo) => void | Promise<void>;

export interface HealthIntegration {
  onIngestFlush: OnIngestFlush;
}

/**
 * Register the strategy + both collectors (immediate) and, when the cross-plugin
 * RPC client is available, build the fast-path evaluation trigger.
 *
 * `rpcClient` is OPTIONAL: the fast-path enumerates healthcheck configs +
 * assignments via the sanctioned cross-plugin RPC client. Without it the
 * fast-path is a no-op (the scheduled tick still evaluates every stream); the
 * strategy + collectors work regardless.
 */
export function registerHealthIntegration({
  storage,
  queueManager,
  cacheManager,
  logger,
  healthCheckRegistry,
  collectorRegistry,
  rpcClient,
}: {
  storage: Storage;
  queueManager: QueueManager;
  cacheManager: CacheManager;
  logger: Logger;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  rpcClient?: RpcClient;
}): HealthIntegration {
  // 1. Strategy + collectors (immediate).
  healthCheckRegistry.register(new TraceStreamHealthStrategy({ storage }));
  collectorRegistry.register(new TraceWindowCollector());
  collectorRegistry.register(new OperationLatencyCollector());

  // 2. Fast-path evaluation trigger. Requires the cross-plugin RPC client.
  if (!rpcClient) {
    logger.warn(
      "tracestream: rpcClient not provided; fast-path health evaluation disabled (scheduled ticks still run).",
    );
    return { onIngestFlush() {} };
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
  const healthQueue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);
  const enqueueRun: EnqueueRun = async ({ payload, jobId }) => {
    await healthQueue.enqueue(payload, { jobId });
  };
  const onIngestFlush = createFastPath({
    resolveAssignments,
    enqueueRun,
    logger,
  });

  return { onIngestFlush };
}
