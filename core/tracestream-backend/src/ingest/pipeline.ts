/**
 * The per-pod trace ingest pipeline: admit -> buffer -> flush. Endpoints and the
 * telemetry sink call {@link IngestPipeline.ingest} with already-decoded
 * {@link NormalizedSpan}s; a 500ms timer (or a >=1000-span buffer) drives the
 * flush, which folds each stream's drained spans and writes them through the
 * storage ports, then fans out post-commit effects (cap / rate-limit important
 * events, a debounced activity signal).
 *
 * STATE & SCALE: the buffer, rate limiter and per-stream debounce/dedup state are
 * pod-local, short-lived write bookkeeping - never a queryable source of truth.
 * Each pod folds its own intake into the shared Postgres tables; a durable read
 * is identical on every pod. See state-and-scale.md.
 *
 * LATE SPANS: no decision-cache check runs here (v1). A span that arrives after
 * its trace was tail-sampling-decided is stored + folds into the summary
 * normally; the maintenance sweep reconciles post-decision arrivals. Documented
 * so this is a deliberate omission, not a gap.
 *
 * ATOMIC FLUSH: a stream's flush writes (spans, summary, op buckets, catalog,
 * activity) run inside ONE transaction via `storage.withFlushTransaction`, so
 * either all commit or none do. Because a failure rolls the batch back and
 * `foldSpans` is additive, a failed flush is safe to RETRY exactly once (nothing
 * was committed, so no double-fold); only if the retry also fails is the batch
 * dropped, with the drop counted on the stream's activity row and logged.
 */

import {
  DEFAULT_TRACE_STREAM_CONFIG,
  TRACESTREAM_ACTIVITY,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  IngestBuffer,
  RateLimiter,
  createFlushLoop,
} from "@checkstack/ingest-utils";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import { prepareSpan, type PreparedSpan } from "./prepare";
import {
  capStreamSpans,
  buildSpanInserts,
  foldAggregates,
  keepPersistedSpans,
} from "./fold";

export const DEFAULT_FLUSH_INTERVAL_MS = 500;
export const DEFAULT_FLUSH_SIZE_THRESHOLD = 1000;
const ACTIVITY_DEBOUNCE_MS = 2000;
/** At most one important event of a given cap/limit kind per stream per window. */
const EVENT_DEDUP_MS = 10 * 60_000;

/** A buffered span tagged with its owning stream (the buffer's item type). */
interface BufferedSpan {
  streamId: string;
  prepared: PreparedSpan;
}

export interface IngestResult {
  accepted: number;
  rejectedRateLimit: number;
  rejectedBuffer: number;
  retryAfterSeconds: number;
}

export interface IngestPipeline {
  /** Admit decoded spans for a stream (rate-limit + prepare + buffer). */
  ingest(input: {
    streamId: string;
    spans: NormalizedSpan[];
    config: TraceStreamConfig;
    now?: Date;
  }): IngestResult;
  /** Run one flush cycle now (also used by the size trigger + timer). */
  flushNow(): Promise<void>;
  /** Start the periodic flush timer. */
  start(): void;
  /** Stop the timer (test cleanup / shutdown). */
  stop(): void;
}

/** Per-stream pod-local bookkeeping: activity debounce + per-kind event dedup. */
interface StreamState {
  lastFlushMs: number;
  lastActivityBroadcastMs: number;
  pendingSpansDelta: number;
  lastEventMs: Record<string, number>;
}

export function createIngestPipeline({
  storage,
  recorder,
  signalService,
  logger,
  now = () => new Date(),
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  flushSizeThreshold = DEFAULT_FLUSH_SIZE_THRESHOLD,
  bufferCap,
  bufferByteCap,
}: {
  storage: Storage;
  recorder: ImportantEventRecorder;
  signalService: SignalService;
  logger: Logger;
  now?: () => Date;
  flushIntervalMs?: number;
  flushSizeThreshold?: number;
  bufferCap?: number;
  bufferByteCap?: number;
}): IngestPipeline {
  const buffer = new IngestBuffer<BufferedSpan>({
    estimateBytes: (item) => item.prepared.estimatedBytes,
    ...(bufferCap === undefined ? {} : { globalCap: bufferCap }),
    ...(bufferByteCap === undefined ? {} : { byteCap: bufferByteCap }),
  });
  const rateLimiter = new RateLimiter();
  const streamConfigs = new Map<string, TraceStreamConfig>();
  const state = new Map<string, StreamState>();

  const loop = createFlushLoop({ runCycle, intervalMs: flushIntervalMs });

  function stateFor(streamId: string): StreamState {
    let s = state.get(streamId);
    if (!s) {
      s = {
        lastFlushMs: 0,
        lastActivityBroadcastMs: 0,
        pendingSpansDelta: 0,
        lastEventMs: {},
      };
      state.set(streamId, s);
    }
    return s;
  }

  function ingest({
    streamId,
    spans,
    config,
    now: at = now(),
  }: Parameters<IngestPipeline["ingest"]>[0]): IngestResult {
    streamConfigs.set(streamId, config);
    if (spans.length === 0) {
      return { accepted: 0, rejectedRateLimit: 0, rejectedBuffer: 0, retryAfterSeconds: 0 };
    }

    const limit = rateLimiter.admit({
      key: streamId,
      count: spans.length,
      limitPerMinute: config.softRateLimitPerMinute,
      now: at,
    });
    const admitted = limit.allowed === spans.length ? spans : spans.slice(0, limit.allowed);

    // Prepare (clamp + byte-cap) each admitted span, counting how many had their
    // attribute payloads dropped to honor `maxSpanBytes`.
    let payloadDropped = 0;
    const items: BufferedSpan[] = admitted.map((span) => {
      const result = prepareSpan({ span, observedAt: at, maxSpanBytes: config.maxSpanBytes });
      if (result.payloadDropped) payloadDropped += 1;
      return { streamId, prepared: result.prepared };
    });
    const push = buffer.push({ key: streamId, items });

    // A rate-limit rejection is surfaced to the viewer timeline (deduped),
    // even when nothing buffered - so a fully-throttled stream still records it.
    if (limit.rejected > 0) {
      void maybeRecordEvent({
        streamId,
        at,
        type: "rate_limited",
        title: `Ingest rate limit reached (${config.softRateLimitPerMinute}/min)`,
        detail: { limitPerMinute: config.softRateLimitPerMinute, droppedSpans: limit.rejected },
      });
    }

    // Byte-cap drops surface the same way (deduped per stream/window), so an
    // operator sees payloads being shed and can raise `maxSpanBytes`.
    if (payloadDropped > 0) {
      void maybeRecordEvent({
        streamId,
        at,
        type: "span_bytes_exceeded",
        title: `Span payloads dropped over ${config.maxSpanBytes} bytes`,
        detail: { maxSpanBytes: config.maxSpanBytes, droppedPayloads: payloadDropped },
      });
    }

    if (buffer.size >= flushSizeThreshold) void loop.flushNow();

    return {
      accepted: push.accepted,
      rejectedRateLimit: limit.rejected,
      rejectedBuffer: push.rejected,
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  async function runCycle(): Promise<void> {
    const drained = buffer.drain();
    for (const [streamId, items] of drained) {
      await flushStream(streamId, items);
    }
  }

  async function flushStream(streamId: string, items: BufferedSpan[]): Promise<void> {
    if (items.length === 0) return;
    const flushAt = now();
    const s = stateFor(streamId);
    const config = streamConfigs.get(streamId) ?? DEFAULT_TRACE_STREAM_CONFIG;

    const elapsedMs =
      s.lastFlushMs > 0 ? Math.max(1, flushAt.getTime() - s.lastFlushMs) : flushIntervalMs;
    s.lastFlushMs = flushAt.getTime();
    const rateEstimate = Math.round((items.length / elapsedMs) * 60_000);

    // Cap per trace (root-priority) and build the insert rows ONCE, outside the
    // transaction; the aggregate fold happens inside, over only the spans the
    // store actually persisted (idempotent re-deliveries fold into nothing).
    const { kept, spanCapDropped } = capStreamSpans({
      spans: items.map((i) => i.prepared),
      maxSpansPerTrace: config.maxSpansPerTrace,
    });
    const inserts = buildSpanInserts({ streamId, spans: kept });

    let droppedServices = 0;
    let droppedOperations = 0;
    let persistedSpanCount = 0;
    // The whole batch commits in ONE transaction; the drop counts and persisted
    // count are (re)assigned inside so a rolled-back attempt leaks no stale value.
    const writeOnce = () =>
      storage.withFlushTransaction(async (ports) => {
        droppedServices = 0;
        droppedOperations = 0;
        persistedSpanCount = 0;
        const insertedKeys = await ports.spans.insertSpans({ spans: inserts });
        persistedSpanCount = insertedKeys.length;
        // Fold summaries / buckets / catalog over the persisted subset only, so a
        // duplicate span never inflates a trace's span count or a latency bucket.
        const persisted = keepPersistedSpans({ spans: kept, insertedKeys });
        const agg = foldAggregates({ streamId, spans: persisted });
        await ports.summaries.upsertFromFlush({ summaries: agg.summaries });
        await ports.opBuckets.foldSpans({ folds: agg.buckets });
        const drops = await ports.serviceOps.touch({
          streamId,
          entries: agg.catalogTouches,
          serviceCap: config.serviceCap,
          operationCapPerService: config.operationCapPerService,
        });
        droppedServices = drops.droppedServices;
        droppedOperations = drops.droppedOperations;
        await ports.activity.touch({
          streamId,
          receivedAt: flushAt,
          rateEstimate,
          droppedSpans: spanCapDropped,
        });
      });

    try {
      await writeOnce();
    } catch (firstError) {
      // The failed transaction rolled back, so retrying cannot double-fold.
      logger.warn(
        `tracestream: flush failed for ${streamId}, retrying once: ${String(firstError)}`,
      );
      try {
        await writeOnce();
      } catch (retryError) {
        logger.error(
          `tracestream: flush retry failed for ${streamId}, dropping ${items.length} spans: ${String(retryError)}`,
        );
        await countDroppedBatch(streamId, flushAt, rateEstimate, items.length);
        return;
      }
    }

    await recordCapEvents({
      streamId,
      flushAt,
      spanCapDropped,
      config,
      droppedServices,
      droppedOperations,
    });
    maybeBroadcastActivity(streamId, s, flushAt, persistedSpanCount);
  }

  /**
   * Record a fully-dropped flush on the stream's activity row (best-effort): the
   * spans WERE received, so `receivedAt`/rate advance, and `droppedSpans` counts
   * the loss for the overview. A failure here is only logged.
   */
  async function countDroppedBatch(
    streamId: string,
    flushAt: Date,
    rateEstimate: number,
    droppedSpans: number,
  ): Promise<void> {
    try {
      await storage.activity.touch({
        streamId,
        receivedAt: flushAt,
        rateEstimate,
        droppedSpans,
      });
    } catch (error) {
      logger.warn(
        `tracestream: failed to record dropped-flush activity for ${streamId}: ${String(error)}`,
      );
    }
  }

  async function recordCapEvents({
    streamId,
    flushAt,
    spanCapDropped,
    config,
    droppedServices,
    droppedOperations,
  }: {
    streamId: string;
    flushAt: Date;
    spanCapDropped: number;
    config: TraceStreamConfig;
    droppedServices: number;
    droppedOperations: number;
  }): Promise<void> {
    if (spanCapDropped > 0) {
      await maybeRecordEvent({
        streamId,
        at: flushAt,
        type: "span_cap_exceeded",
        title: `Span-per-trace cap reached (${config.maxSpansPerTrace})`,
        detail: { maxSpansPerTrace: config.maxSpansPerTrace, droppedSpans: spanCapDropped },
      });
    }
    if (droppedServices > 0) {
      await maybeRecordEvent({
        streamId,
        at: flushAt,
        type: "service_cap_exceeded",
        title: `Service cap reached (${config.serviceCap})`,
        detail: { serviceCap: config.serviceCap, droppedServices },
      });
    }
    if (droppedOperations > 0) {
      await maybeRecordEvent({
        streamId,
        at: flushAt,
        type: "operation_cap_exceeded",
        title: `Operation cap reached (${config.operationCapPerService}/service)`,
        detail: { operationCapPerService: config.operationCapPerService, droppedOperations },
      });
    }
  }

  /** Record an important event at most once per stream per {@link EVENT_DEDUP_MS} per type. */
  async function maybeRecordEvent({
    streamId,
    at,
    type,
    title,
    detail,
  }: {
    streamId: string;
    at: Date;
    type:
      | "rate_limited"
      | "span_bytes_exceeded"
      | "span_cap_exceeded"
      | "service_cap_exceeded"
      | "operation_cap_exceeded";
    title: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const s = stateFor(streamId);
    const nowMs = at.getTime();
    if (nowMs - (s.lastEventMs[type] ?? 0) < EVENT_DEDUP_MS) return;
    s.lastEventMs[type] = nowMs;
    try {
      await recorder.record({ streamId, ts: at, type, title, detail });
    } catch (error) {
      logger.warn(`tracestream: failed to record ${type} event for ${streamId}: ${String(error)}`);
    }
  }

  function maybeBroadcastActivity(
    streamId: string,
    s: StreamState,
    flushAt: Date,
    delta: number,
  ): void {
    s.pendingSpansDelta += delta;
    const nowMs = flushAt.getTime();
    if (nowMs - s.lastActivityBroadcastMs < ACTIVITY_DEBOUNCE_MS) return;
    const spansDelta = s.pendingSpansDelta;
    s.lastActivityBroadcastMs = nowMs;
    s.pendingSpansDelta = 0;
    void signalService
      .broadcast(TRACESTREAM_ACTIVITY, { streamId, spansDelta })
      .catch((error: unknown) =>
        logger.warn(`tracestream: activity broadcast failed for ${streamId}: ${String(error)}`),
      );
  }

  return {
    ingest,
    flushNow: loop.flushNow,
    start: loop.start,
    stop: loop.stop,
  };
}
