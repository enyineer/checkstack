/**
 * The per-pod ingest pipeline: admit -> buffer -> flush. Endpoints call
 * {@link IngestPipeline.ingest} with already-normalized lines; a 500ms timer (or
 * a >=1000-line buffer) drives {@link IngestPipeline.flushNow}, which flushes
 * each stream in one transaction and fans out the post-commit effects
 * (important events, the health fast-path hook, and a debounced activity
 * signal).
 *
 * STATE & SCALE: the buffer, sampler, rate limiter, token-use tracker and
 * counters are all pod-local and short-lived - a write buffer and bookkeeping,
 * never a queryable source of truth. Each pod flushes its own intake to the
 * shared database; a read of durable state (buckets/events) is identical on
 * every pod. See buffer.ts and state-and-scale.md.
 */

import { eq, sql } from "drizzle-orm";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  LOGSTREAM_ACTIVITY,
  worstBand as worseOf,
  type LogStreamConfig,
  type RecordImportantEventInput,
  type SeverityBand,
} from "@checkstack/logstream-common";
import {
  withScopedTransaction,
  type SafeDatabase,
  type Logger,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import * as schema from "../schema";
import { logStreamTokens } from "../schema";
import type { Storage } from "../storage";
import type { DrainEngine } from "../drain/engine";
import type { ImportantEventRecorder } from "../events/recorder";
import type { OnIngestFlush } from "../health/setup";
import { createFlushLoop } from "@checkstack/ingest-utils";
import { IngestBuffer } from "./buffer";
import { RateLimiter } from "./rate-limit";
import { TokenUseTracker } from "./token-use";
import { IngestCountersRegistry, ingestCounters } from "./counters";
import { writeFlush, detectSpike, type FlushPlan } from "./flush";
import {
  createInProcessFlushExecutor,
  type FlushExecutor,
} from "./flush-executor";

export const DEFAULT_FLUSH_INTERVAL_MS = 500;
export const DEFAULT_FLUSH_SIZE_THRESHOLD = 1000;
const ACTIVITY_DEBOUNCE_MS = 2000;
const DEFAULT_RETRY_BACKOFF_MS = 100;
/** How often (per stream) to re-resolve the healthcheck-referenced protected set. */
const PROTECTED_REFRESH_INTERVAL_MS = 60_000;

/**
 * Resolve the pattern ids a stream's healthcheck collectors reference, so the
 * drain engine can pin them as protected (never re-mined under a fresh id).
 * Supplied by the health integration; absent on pods without it (protection then
 * relies on `origin: 'user'` alone).
 */
export type GetReferencedPatternIds = (
  streamId: string,
) => Promise<readonly string[]>;

export interface IngestResult {
  accepted: number;
  rejectedRateLimit: number;
  rejectedBuffer: number;
  retryAfterSeconds: number;
}

export interface IngestPipeline {
  /** Admit normalized lines for a stream (rate-limit + buffer). */
  ingest(input: {
    streamId: string;
    lines: import("@checkstack/logstream-common").IngestedLine[];
    config: LogStreamConfig;
    tokenId?: string;
    now?: Date;
  }): IngestResult;
  /** Run one flush cycle now (also used by the size trigger + timer). */
  flushNow(): Promise<void>;
  /** Start the periodic flush timer. */
  start(): void;
  /** Stop the timer (test cleanup / shutdown). */
  stop(): void;
}

interface ActivityState {
  lastBroadcast: number;
  linesDelta: number;
  worst: SeverityBand;
}

export function createIngestPipeline({
  db,
  storage,
  drain,
  executor: providedExecutor,
  recorder,
  signalService,
  logger,
  onIngestFlush,
  getReferencedPatternIds,
  counters = ingestCounters,
  now = () => new Date(),
  rng,
  bufferCap,
  bufferByteCap,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  flushSizeThreshold = DEFAULT_FLUSH_SIZE_THRESHOLD,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  /**
   * The main-thread Drain engine. Used to build the default in-process
   * {@link FlushExecutor} when `executor` is not supplied (the unit-test and
   * workers-disabled path). Ignored when an `executor` is passed.
   */
  drain: DrainEngine;
  /**
   * Pre-built flush executor (the worker pool in production when
   * `CHECKSTACK_LOGSTREAM_INGEST_WORKERS` selects it). When omitted, an
   * in-process executor is built from `drain`, reproducing the pre-Phase-D
   * behavior exactly. The pipeline never stops a provided executor - its owner
   * (the ingest teardown) does.
   */
  executor?: FlushExecutor;
  recorder: ImportantEventRecorder;
  signalService: SignalService;
  logger: Logger;
  onIngestFlush: OnIngestFlush;
  /** Optional protected-set resolver; refreshed per stream on the flush cycle. */
  getReferencedPatternIds?: GetReferencedPatternIds;
  counters?: IngestCountersRegistry;
  now?: () => Date;
  rng?: () => number;
  bufferCap?: number;
  bufferByteCap?: number;
  flushIntervalMs?: number;
  flushSizeThreshold?: number;
  retryBackoffMs?: number;
}): IngestPipeline {
  const buffer = new IngestBuffer(bufferCap, bufferByteCap);
  const executor =
    providedExecutor ?? createInProcessFlushExecutor({ drain, logger, rng });
  const rateLimiter = new RateLimiter();
  const tokenUse = new TokenUseTracker();
  const streamConfigs = new Map<string, LogStreamConfig>();
  const activity = new Map<string, ActivityState>();
  // Per-stream protected-set refresh bookkeeping. `lastAttemptMs` bounds the
  // resolver call to once per interval; `lastIds` is the most recent resolved
  // set (retained so an executor reset can re-push it WITHOUT re-resolving);
  // `appliedKey` is `<epoch>|<ids>` for the set last pushed, so an unchanged
  // set AND an unchanged epoch skip the drain call.
  const protectedState = new Map<
    string,
    {
      lastAttemptMs: number;
      appliedKey: string | null;
      lastIds: readonly string[] | null;
    }
  >();

  // The timer + single-inflight flush skeleton is the shared ingest-utils
  // mechanism; this pipeline keeps its drain/worker-specific runCycle on top.
  const loop = createFlushLoop({ runCycle, intervalMs: flushIntervalMs });

  function ingest({
    streamId,
    lines,
    config,
    tokenId,
    now: at = now(),
  }: Parameters<IngestPipeline["ingest"]>[0]): IngestResult {
    streamConfigs.set(streamId, config);

    const limit = rateLimiter.admit({
      key: streamId,
      count: lines.length,
      limitPerMinute: config.softRateLimitPerMinute,
      now: at,
    });
    const admitted = limit.allowed === lines.length ? lines : lines.slice(0, limit.allowed);
    const push = buffer.push({ streamId, lines: admitted });

    counters.addReceived(streamId, push.accepted);
    const dropped = limit.rejected + push.rejected;
    if (dropped > 0) counters.addDropped(streamId, dropped);
    if (tokenId && push.accepted > 0) tokenUse.record({ tokenId, at });

    if (buffer.size >= flushSizeThreshold) void loop.flushNow();

    return {
      accepted: push.accepted,
      rejectedRateLimit: limit.rejected,
      rejectedBuffer: push.rejected,
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  async function runCycle(): Promise<void> {
    const uses = tokenUse.drain();
    if (uses.length > 0) await persistTokenUses(uses);

    const drained = buffer.drain();
    for (const [streamId, lines] of drained) {
      await flushStream(streamId, lines);
    }
  }

  async function flushStream(
    streamId: string,
    lines: import("@checkstack/logstream-common").IngestedLine[],
  ): Promise<void> {
    const startMs = performance.now();
    const flushAt = now();
    const config = streamConfigs.get(streamId) ?? DEFAULT_LOG_STREAM_CONFIG;

    // Refresh the healthcheck-referenced protected set for this stream (at most
    // once per 60s, cheap set-compare) so a still-referenced but quiet pattern
    // is never re-mined under a fresh id. Never breaks the flush. The executor
    // proxies this to wherever the Drain tree lives (in-process or worker).
    await refreshProtectedPatterns(streamId, flushAt);

    let plan: FlushPlan;
    try {
      // The executor owns hydration + classify + fold + sample; it runs inline
      // in-process, or in the stream's owning worker when the pool is enabled.
      plan = await executor.prepare({
        streamId,
        lines,
        config,
        now: flushAt,
        flushIntervalMs,
      });
    } catch (error) {
      logger.error(
        `logstream: prepareFlush failed for ${streamId}, dropping ${lines.length} lines: ${String(error)}`,
      );
      counters.addDropped(streamId, lines.length);
      return;
    }

    try {
      await runWrite(plan, flushAt);
    } catch {
      await sleep(retryBackoffMs);
      try {
        await runWrite(plan, flushAt);
      } catch (error) {
        logger.error(
          `logstream: flush write failed twice for ${streamId}, dropping ${plan.linesClassified} lines: ${String(error)}`,
        );
        counters.addDropped(streamId, plan.linesClassified);
        return;
      }
    }

    counters.recordFlush(streamId, performance.now() - startMs);
    if (plan.droppedByCap > 0) counters.addDropped(streamId, plan.droppedByCap);

    // Spike detection reads run AFTER the write commits, in their own read
    // transaction, so their SELECTs never lengthen the write's lock hold.
    const spikeEvents = await detectSpikePostCommit(plan, flushAt);

    for (const event of [...plan.newPatternEvents, ...spikeEvents]) {
      try {
        await recorder.record(event);
      } catch (error) {
        logger.warn(`logstream: failed to record important event: ${String(error)}`);
      }
    }

    try {
      await onIngestFlush({
        streamId,
        worstBand: plan.worstBand,
        errorDelta: plan.errorDelta,
      });
    } catch (error) {
      logger.warn(`logstream: onIngestFlush hook failed: ${String(error)}`);
    }

    maybeBroadcastActivity(streamId, plan.linesClassified, plan.worstBand, flushAt);
  }

  /**
   * Re-resolve and push a stream's healthcheck-referenced protected set to the
   * executor's Drain tree. The resolver (a DB read) is throttled to once per
   * {@link PROTECTED_REFRESH_INTERVAL_MS} per stream, but the PUSH decision also
   * keys on the executor's protection epoch: when the tree hosting this stream is
   * reset (a worker respawn, or a dead worker's streams handed to the in-process
   * fallback) the epoch changes and we re-push the last-known set on the NEXT
   * flush - without waiting for the resolver cadence - so a fresh, empty tree
   * cannot silently drop a still-referenced mined pattern's protection. Runs on
   * the flush cycle (right after hydration) and MUST NOT break the flush: any
   * resolver failure is logged and swallowed. A no-op without a resolver.
   */
  async function refreshProtectedPatterns(streamId: string, at: Date): Promise<void> {
    if (!getReferencedPatternIds) return;
    const epoch = executor.protectionEpoch({ streamId });
    let state = protectedState.get(streamId);

    const dueToResolve =
      !state ||
      at.getTime() - state.lastAttemptMs >= PROTECTED_REFRESH_INTERVAL_MS;

    if (dueToResolve) {
      // Record the attempt up front (a new state object we then fill in) so a
      // slow/failing resolver cannot be retried on every flush; the cadence
      // holds regardless of outcome.
      state = {
        lastAttemptMs: at.getTime(),
        appliedKey: state?.appliedKey ?? null,
        lastIds: state?.lastIds ?? null,
      };
      protectedState.set(streamId, state);
      try {
        const ids = await getReferencedPatternIds(streamId);
        state.lastIds = [...new Set(ids)].toSorted();
      } catch (error) {
        logger.warn(
          `logstream: protected-pattern refresh failed for ${streamId}: ${String(error)}`,
        );
        // Keep the previous lastIds; the epoch check below may still need to
        // re-push it to a freshly reset tree.
      }
    }

    // Push when the (epoch, ids) pair differs from what we last pushed. This
    // covers BOTH a changed referenced set (resolved above) and an executor
    // reset (epoch bumped) that must re-push the unchanged set. Nothing to push
    // until the resolver has succeeded at least once.
    if (!state || state.lastIds === null) return;
    const key = `${epoch}|${state.lastIds.join(",")}`;
    if (key === state.appliedKey) return;
    executor.setProtectedPatterns({ streamId, patternIds: state.lastIds });
    state.appliedKey = key;
  }

  function runWrite(plan: FlushPlan, flushAt: Date): Promise<void> {
    return withScopedTransaction(db, (tx) =>
      writeFlush({ tx, plan, storage, now: flushAt }),
    );
  }

  async function detectSpikePostCommit(
    plan: FlushPlan,
    flushAt: Date,
  ): Promise<RecordImportantEventInput[]> {
    if (plan.errorDelta === 0 || plan.affectedErrorMinutes.length === 0) {
      return [];
    }
    try {
      const spike = await withScopedTransaction(db, (tx) =>
        detectSpike({ runner: tx, plan, storage, now: flushAt }),
      );
      return spike ? [spike] : [];
    } catch (error) {
      logger.warn(
        `logstream: spike detection failed for ${plan.streamId}: ${String(error)}`,
      );
      return [];
    }
  }

  async function persistTokenUses(
    uses: { tokenId: string; at: Date }[],
  ): Promise<void> {
    try {
      await withScopedTransaction(db, async (tx) => {
        for (const use of uses) {
          // Advance `lastUsedAt` monotonically (`greatest`) so a clock-skewed
          // pod cannot move it backward - matches `touchStreamActivity`'s
          // `lastReceivedAt` handling in storage/activity.ts.
          await tx
            .update(logStreamTokens)
            .set({
              lastUsedAt: sql`greatest(${logStreamTokens.lastUsedAt}, ${use.at})`,
            })
            .where(eq(logStreamTokens.id, use.tokenId));
        }
      });
    } catch (error) {
      logger.warn(`logstream: failed to update token lastUsedAt: ${String(error)}`);
    }
  }

  function maybeBroadcastActivity(
    streamId: string,
    linesDelta: number,
    worst: SeverityBand,
    at: Date,
  ): void {
    const state =
      activity.get(streamId) ??
      ({ lastBroadcast: 0, linesDelta: 0, worst: "trace" } as ActivityState);
    state.linesDelta += linesDelta;
    state.worst = worseOf({ a: state.worst, b: worst });
    activity.set(streamId, state);

    const atMs = at.getTime();
    if (atMs - state.lastBroadcast < ACTIVITY_DEBOUNCE_MS) return;

    const payload = {
      streamId,
      linesDelta: state.linesDelta,
      worstBand: state.worst,
    };
    state.lastBroadcast = atMs;
    state.linesDelta = 0;
    state.worst = "trace";
    void signalService
      .broadcast(LOGSTREAM_ACTIVITY, payload)
      .catch((error: unknown) =>
        logger.warn(`logstream: activity broadcast failed: ${String(error)}`),
      );
  }

  return {
    ingest,
    flushNow: loop.flushNow,
    start: loop.start,
    stop: loop.stop,
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
