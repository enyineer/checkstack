/**
 * Event-triggered (fast-path) health evaluation. When an ingest flush commits
 * error/fatal lines for a stream, we enqueue a DEBOUNCED one-off evaluation for
 * every enabled assignment SLICE (per effective environment) of every enabled
 * logstream configuration that references the stream - so a burst is reflected
 * in health within seconds instead of at the next scheduled tick.
 *
 * The enqueue targets the SHARED health-checks queue directly (the QueueManager
 * is a global singleton, not plugin-namespaced). Assignment discovery + the
 * per-assignment environment fan-out use the sanctioned domain->common RPC path
 * (`HealthCheckApi`), cached 60s per stream.
 *
 * Two mechanisms keep the fast-path from ever pressuring the ingest flush loop
 * (which invokes `onIngestFlush`):
 *  1. The hook returns SYNCHRONOUSLY - the real fan-out runs on a detached
 *     promise (errors logged, never rethrown), so the flush loop never awaits a
 *     Redis round-trip.
 *  2. A pod-local attempted-bucket map collapses repeat flushes: once a slice
 *     has been enqueued in a given 15s debounce bucket, further flushes in the
 *     same bucket do ZERO queue work (BullMQ's jobId only dedupes the enqueued
 *     JOB, not the enqueue ATTEMPT - so without this every error flush issued a
 *     Redis add per slice).
 */

import type { Logger } from "@checkstack/backend-api";
import type { RpcClient } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  SEVERITY_BAND_RANK,
  type SeverityBand,
} from "@checkstack/logstream-common";
import {
  fastPathJobId,
  FAST_PATH_DEBOUNCE_MS,
  LOGSTREAM_QUALIFIED_STRATEGY_ID,
  type LogStreamRunJobPayload,
} from "./constants";
import type { IngestFlushInfo } from "./setup";

/**
 * An enabled assignment of a logstream configuration to a system, resolved down
 * to the effective environment slices the executor will accept. `environmentIds`
 * is `[null]` for an env-less system (a single env-less run), else the effective
 * environment ids.
 */
export interface StreamAssignment {
  configId: string;
  systemId: string;
  environmentIds: (string | null)[];
}

/** Resolve (cached) the enabled assignment slices that reference a stream. */
export type ResolveStreamAssignments = (
  streamId: string,
) => Promise<StreamAssignment[]>;

/** Enqueue one one-off run (abstracts the shared queue for testing). */
export type EnqueueRun = (args: {
  payload: LogStreamRunJobPayload;
  jobId: string;
}) => Promise<void>;

/**
 * The fast-path hook. Callable as the ingest `OnIngestFlush` (returns void,
 * never blocks the flush loop). `whenIdle` is a TEST affordance: it resolves
 * once every detached fan-out scheduled so far has settled.
 */
export interface FastPathHook {
  (info: IngestFlushInfo): void;
  whenIdle(): Promise<void>;
}

const ERROR_RANK = SEVERITY_BAND_RANK.error;

/** Whether a worst-band warrants a fast-path evaluation (>= error). */
export function shouldFastPath(worstBand: SeverityBand): boolean {
  return SEVERITY_BAND_RANK[worstBand] >= ERROR_RANK;
}

/**
 * Pod-local record of which assignment slices have already been enqueued in the
 * current debounce bucket, so repeat flushes in the same bucket enqueue nothing.
 *
 * This is deliberately POD-LOCAL bookkeeping, never a source of truth: BullMQ's
 * jobId is the CROSS-POD dedupe (two pods flushing the same bucket still collapse
 * to one job). The map only spares THIS pod redundant Redis adds; a missed entry
 * (e.g. after a restart) costs at most one extra add that BullMQ dedupes anyway.
 * Bounded: entries older than the previous bucket are pruned, and a hard cap
 * evicts eagerly so a churn of streams can never grow it without bound.
 */
class AttemptedBuckets {
  private readonly seen = new Map<string, number>();
  private readonly maxEntries: number;

  constructor({ maxEntries = 50_000 }: { maxEntries?: number } = {}) {
    this.maxEntries = maxEntries;
  }

  /**
   * Mark `key` attempted for `bucket`. Returns true when this is the FIRST
   * attempt in that bucket (caller should enqueue), false when already attempted
   * (caller should skip).
   */
  mark(key: string, bucket: number): boolean {
    if (this.seen.get(key) === bucket) return false;
    this.prune(bucket);
    this.seen.set(key, bucket);
    return true;
  }

  /** Drop entries from buckets older than the previous one; hard-cap the size. */
  private prune(bucket: number): void {
    for (const [key, seenBucket] of this.seen) {
      if (seenBucket < bucket - 1) this.seen.delete(key);
    }
    if (this.seen.size < this.maxEntries) return;
    // Still oversized after pruning stale buckets: evict oldest-inserted first.
    const overflow = this.seen.size - this.maxEntries + 1;
    let removed = 0;
    for (const key of this.seen.keys()) {
      this.seen.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

/**
 * Build the fast-path hook from its collaborators. Kept collaborator-injected
 * so the fan-out + debounced jobId can be unit-tested with a mocked resolver
 * and enqueue.
 */
export function createFastPath({
  resolveAssignments,
  enqueueRun,
  logger,
  now = () => Date.now(),
}: {
  resolveAssignments: ResolveStreamAssignments;
  enqueueRun: EnqueueRun;
  logger: Logger;
  now?: () => number;
}): FastPathHook {
  const attempted = new AttemptedBuckets();
  const pending = new Set<Promise<void>>();

  const fanOut = async ({ streamId }: IngestFlushInfo): Promise<void> => {
    const assignments = await resolveAssignments(streamId);
    if (assignments.length === 0) return;
    const nowMs = now();
    const bucket = Math.floor(nowMs / FAST_PATH_DEBOUNCE_MS);

    // Mark every not-yet-attempted slice SYNCHRONOUSLY (no await between marks)
    // so two concurrent fan-outs for the same stream+bucket cannot both enqueue.
    const toEnqueue: { payload: LogStreamRunJobPayload; jobId: string }[] = [];
    for (const assignment of assignments) {
      for (const environmentId of assignment.environmentIds) {
        const key = `${assignment.configId}:${assignment.systemId}:${environmentId ?? "_"}`;
        if (!attempted.mark(key, bucket)) continue;
        toEnqueue.push({
          payload: {
            configId: assignment.configId,
            systemId: assignment.systemId,
            environmentId,
          },
          jobId: fastPathJobId({
            configId: assignment.configId,
            systemId: assignment.systemId,
            environmentId,
            nowMs,
          }),
        });
      }
    }
    if (toEnqueue.length === 0) return;

    await Promise.all(toEnqueue.map((run) => enqueueRun(run)));
    logger.debug(
      `logstream fast-path: enqueued ${toEnqueue.length} evaluation(s) for stream ${streamId}`,
    );
  };

  const hook = ((info: IngestFlushInfo): void => {
    if (!shouldFastPath(info.worstBand)) return;
    // Detached: the ingest flush loop must NOT await queue work. Any
    // discovery/enqueue failure is logged, never rethrown - the scheduled tick
    // still evaluates the stream.
    const work = fanOut(info)
      .catch((error) => {
        logger.warn(
          `logstream fast-path failed for stream ${info.streamId}: ${String(error)}`,
        );
      })
      .finally(() => {
        pending.delete(work);
      });
    pending.add(work);
  }) as FastPathHook;

  hook.whenIdle = async () => {
    // Loop in case a settling fan-out scheduled more work (it does not today,
    // but keeps the affordance correct if that ever changes).
    while (pending.size > 0) {
      await Promise.allSettled(pending);
    }
  };

  return hook;
}

/**
 * Cached resolver for a stream's enabled assignment SLICES, built on the trusted
 * cross-plugin RPC client. Enumerates logstream configurations, filters to those
 * referencing the stream (and not paused), collects their enabled assignments,
 * and resolves each assignment's effective environment ids via the sanctioned
 * `resolveEnqueueEnvironments` procedure. Cached 60s per stream (a 60s staleness
 * is acceptable - the scheduled tick covers anything the cache misses).
 */
export function createHealthcheckAssignmentResolver({
  rpcClient,
  cache,
  cacheTtlMs = 60_000,
}: {
  rpcClient: RpcClient;
  cache: CachedScope;
  cacheTtlMs?: number;
}): ResolveStreamAssignments {
  return (streamId: string) =>
    cache.wrap(
      `fast-assignments:${streamId}`,
      async () => {
        const client = rpcClient.forPlugin(HealthCheckApi);
        const { configurations } = await client.getConfigurations();
        const matching = configurations.filter(
          (c) =>
            c.strategyId === LOGSTREAM_QUALIFIED_STRATEGY_ID &&
            !c.paused &&
            readStreamId(c.config) === streamId,
        );

        const assignments: StreamAssignment[] = [];
        for (const config of matching) {
          const rows = await client.getConfigurationAssignments({
            configId: config.id,
          });
          for (const row of rows) {
            if (!row.enabled) continue;
            // Resolve the SAME environment slices the executor accepts, so an
            // env-assigned system is not silently skipped as a stale env-less
            // job (the executor drops `environmentId: null` runs when the system
            // has effective environments).
            const { environmentIds } = await client.resolveEnqueueEnvironments({
              configId: config.id,
              systemId: row.systemId,
            });
            assignments.push({
              configId: config.id,
              systemId: row.systemId,
              environmentIds,
            });
          }
        }
        return assignments;
      },
      { ttlMs: cacheTtlMs },
    );
}

/** Read `streamId` from a stored strategy config record (no cast to any). */
function readStreamId(config: Record<string, unknown>): string | undefined {
  const value = config.streamId;
  return typeof value === "string" ? value : undefined;
}
