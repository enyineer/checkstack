/**
 * Metric assembly for the trace-stream health collectors. The complete-minute
 * window math + seconds-since-last helper are shared across the observability
 * plugins and live in `@checkstack/healthcheck-common` (`health-window.ts`);
 * this file keeps only the trace-specific result shapes + `build*` assembly.
 * IO-free so it can be unit-tested without a database (the reads live in
 * `./reader`).
 */

import { computeSecondsSinceLast } from "@checkstack/healthcheck-common";
import type { TraceWindowLatency } from "../storage";
import type { WindowSpanTotals, WindowTraceTotals } from "./reader";

/** The trace-window collector's per-run result (all numeric, assertable). */
export interface TraceWindowResult {
  /** Service-labeled spans over the window (op-bucket population). */
  spanCount: number;
  /** Traces whose start fell in the window (summary index). */
  traceCount: number;
  /** Error spans over the window. */
  errorSpanCount: number;
  /** Traces with any error span over the window. */
  errorTraceCount: number;
  /** Error spans per minute over the whole-minute window. */
  errorRatePerMinute: number;
  /**
   * Whole seconds since the stream last received ANY span. When the stream has
   * never received a span, this counts from stream creation (NOT a sentinel), so
   * an absence assertion is meaningful from creation.
   */
  secondsSinceLastSpan: number;
}

/**
 * Assemble the trace-window result from already-read aggregates. Pure: all IO is
 * done by the caller. Span-level counts come from the op-bucket minute tier and
 * trace-level counts from the summary index - two grains of the same window.
 */
export function buildTraceWindowMetrics({
  spanTotals,
  traceTotals,
  now,
  lastReceivedAt,
  streamCreatedAt,
  windowMinutes,
}: {
  spanTotals: WindowSpanTotals;
  traceTotals: WindowTraceTotals;
  now: Date;
  lastReceivedAt: Date | null;
  streamCreatedAt: Date;
  windowMinutes: number;
}): TraceWindowResult {
  const minutes = Math.max(1, windowMinutes);
  return {
    spanCount: spanTotals.spanCount,
    traceCount: traceTotals.traceCount,
    errorSpanCount: spanTotals.errorSpanCount,
    errorTraceCount: traceTotals.errorTraceCount,
    errorRatePerMinute: round2(spanTotals.errorSpanCount / minutes),
    secondsSinceLastSpan: computeSecondsSinceLast({
      now,
      lastAt: lastReceivedAt,
      streamCreatedAt,
    }),
  };
}

/** The operation-latency collector's per-run result (all numeric, assertable). */
export interface OperationLatencyResult {
  /** p95 latency (ms) over the window, from the merged t-digest; 0 when empty. */
  p95Ms: number;
  /** Mean latency (ms) over the window (durSum / spanCount); 0 when empty. */
  avgMs: number;
  /** Max single-span latency (ms) over the window; 0 when empty. */
  maxMs: number;
  /** Spans matched by the (service, op?) selection over the window. */
  spanCount: number;
  /** Error spans among them. */
  errorCount: number;
  /** Fraction of matched spans that errored (0..1); 0 when the window is empty. */
  errorRate: number;
}

/**
 * Assemble the operation-latency result from a windowed merged aggregate. Pure:
 * the read is done by the caller. An empty window yields zeroed fields
 * (healthcheck result fields must be numbers, never null); assert on
 * `spanCount > 0` alongside a latency assertion so a quiet window (which reports
 * `p95/avg/max = 0`) is not mistaken for a real zero reading.
 */
export function buildOperationLatency({
  window,
}: {
  window: TraceWindowLatency;
}): OperationLatencyResult {
  const spanCount = window.spanCount;
  return {
    p95Ms: window.p95Ms ?? 0,
    avgMs: spanCount > 0 ? round2(window.durSumMs / spanCount) : 0,
    maxMs: window.durMaxMs ?? 0,
    spanCount,
    errorCount: window.errorCount,
    errorRate: spanCount > 0 ? round4(window.errorCount / spanCount) : 0,
  };
}

/** Round to 2 decimals to keep rate/latency metrics tidy for charts/assertions. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Round a ratio to 4 decimals (a 0..1 error fraction needs finer resolution). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
