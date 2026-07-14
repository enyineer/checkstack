/**
 * Read side of the trace-stream health collectors. Every method is a single
 * cheap read over the PRE-AGGREGATED tables (op-bucket minute tier, the trace
 * summary index, the activity row) - the evaluation tick NEVER touches raw
 * `trace_spans` and never does per-span work.
 *
 * Reads run through the storage PORTS (never drizzle directly). Query FAILURES
 * propagate as thrown errors so the collector maps them to a transport error
 * (per the collector rule); an empty result is a metric (zero), never an error.
 */

import type { Storage, TraceWindowLatency } from "../storage";

/** Minimal stream identity a reader is bound to (loaded once at connect). */
export interface StreamHandle {
  streamId: string;
  streamCreatedAt: Date;
}

/** Span-level counts over a window (from the op-bucket minute tier). */
export interface WindowSpanTotals {
  /**
   * Spans over the window. Sourced from the op-bucket minute tier, so this counts
   * SERVICE-LABELED spans (the operation-metric population); unlabeled spans are
   * stored + summarized but carry no operation dimension to aggregate.
   */
  spanCount: number;
  /** Error spans over the window (same service-labeled population as `spanCount`). */
  errorSpanCount: number;
}

/** Trace-level counts over a window (from the summary index). */
export interface WindowTraceTotals {
  traceCount: number;
  errorTraceCount: number;
}

/**
 * Windowed reads used by the trace-window and operation-latency collectors.
 * Bound to a single stream. All windows are half-open `[from, to)` over minute
 * buckets.
 */
export interface TraceStreamHealthReader {
  readonly streamId: string;
  readonly streamCreatedAt: Date;
  /** Span-level totals over the window (op-bucket minute tier; zero-filled). */
  readWindowSpanTotals(args: { from: Date; to: Date }): Promise<WindowSpanTotals>;
  /** Trace-level totals for traces whose start falls at/after `since`. */
  readWindowTraceTotals(args: { since: Date }): Promise<WindowTraceTotals>;
  /** When the stream last received ANY span, or null if never. */
  readLastReceivedAt(): Promise<Date | null>;
  /**
   * Merged latency/volume aggregate for one `(service, op?)` selection over the
   * window (the operation-latency collector's read). The p95 comes from the
   * t-digest merged across the whole window (see `queryWindowLatency`).
   */
  readOperationLatency(args: {
    serviceName: string;
    spanName?: string;
    from: Date;
    to: Date;
  }): Promise<TraceWindowLatency>;
}

/**
 * Load a stream's identity, or `null` when the stream row no longer exists. The
 * strategy uses `null` as the "connection failure" signal (a config error: the
 * referenced stream was deleted).
 */
export async function loadStreamHandle({
  storage,
  streamId,
}: {
  storage: Storage;
  streamId: string;
}): Promise<StreamHandle | null> {
  const stream = await storage.streams.get({ id: streamId });
  if (!stream) return null;
  return { streamId: stream.id, streamCreatedAt: stream.createdAt };
}

/** Build the storage-backed reader for one stream. */
export function createStorageReader({
  storage,
  handle,
}: {
  storage: Storage;
  handle: StreamHandle;
}): TraceStreamHealthReader {
  const { streamId, streamCreatedAt } = handle;

  return {
    streamId,
    streamCreatedAt,

    async readWindowSpanTotals({ from, to }) {
      // Health windows are short (complete minutes + the in-progress minute),
      // always inside the minute-tier retention, so a single minute-grain read
      // covers them. SUM the counts in SQL - the two integers are all we need,
      // so we never fetch/merge the per-bucket t-digests queryBuckets returns.
      return storage.opBuckets.sumWindowCounts({
        streamId,
        from,
        to,
        grain: "minute",
      });
    },

    async readWindowTraceTotals({ since }) {
      const totals = await storage.summaries.overviewTotals({ streamId, since });
      return { traceCount: totals.traces, errorTraceCount: totals.errorTraces };
    },

    async readLastReceivedAt() {
      const activity = await storage.activity.read({ streamId });
      return activity?.lastReceivedAt ?? null;
    },

    async readOperationLatency({ serviceName, spanName, from, to }) {
      return storage.opBuckets.queryWindowLatency({
        streamId,
        serviceName,
        spanName,
        from,
        to,
        grain: "minute",
      });
    },
  };
}
