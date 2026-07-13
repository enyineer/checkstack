/**
 * Pure window math + metric assembly for the log-stream health collectors.
 *
 * The health EVALUATION is a cheap periodic read of pre-aggregated minute
 * buckets - never a per-line computation. These functions are IO-free so the
 * bucket-boundary and complete-minute semantics can be unit-tested without a
 * database (the DB reads live in `./reader`).
 */

import type {
  StreamSeverityTotals,
  PatternVariableWindow,
} from "@checkstack/logstream-common";
import { floorToMinute } from "../storage";

/** Absolute floor on a health window: one whole minute. */
export const MIN_WINDOW_SECONDS = 60;

/** A resolved evaluation window over minute buckets. */
export interface WindowBounds {
  /** Inclusive start of the window (minute-aligned). */
  from: Date;
  /**
   * Exclusive end of the COMPLETE-minute window: the start of the minute
   * containing `now`, i.e. the boundary AFTER the last COMPLETE minute. Used as
   * the rate DENOMINATOR boundary (`windowMinutes` whole minutes) and for any
   * semantics where a partial minute would mislead.
   */
  to: Date;
  /**
   * Exclusive end for the COUNT reads: the end of the in-progress minute
   * (`to + 1 minute`). Reading `[from, readTo)` additively includes the current
   * partial minute bucket so a burst seconds into the minute is visible to a
   * fast-path evaluation that same second - without waiting for the minute to
   * complete. Bucket counts are monotonic within a minute, so including partial
   * data can only make error assertions fire EARLIER, never report a false low.
   * (Rates divide by `windowMinutes`, so during the partial minute a rate may
   * momentarily read slightly high - i.e. undercount the true elapsed
   * denominator - which likewise only surfaces a problem sooner.)
   */
  readTo: Date;
  /** Whole COMPLETE minutes spanned by `[from, to)` (>= 1). */
  windowMinutes: number;
}

/**
 * Resolve the evaluation window. `windowSeconds` defaults to the check's
 * interval, is floored to a whole number of minutes, and is clamped to at least
 * one minute. The complete-minute window ends at the last COMPLETE minute
 * (`to`); the COUNT reads additionally include the in-progress minute (`readTo`)
 * so a just-arrived burst is visible immediately (see {@link WindowBounds}).
 */
export function computeWindowBounds({
  now,
  windowSeconds,
  intervalSeconds,
}: {
  now: Date;
  windowSeconds: number | undefined;
  intervalSeconds: number;
}): WindowBounds {
  const requested = windowSeconds ?? intervalSeconds;
  const safeRequested =
    Number.isFinite(requested) && requested > 0
      ? requested
      : MIN_WINDOW_SECONDS;
  const effectiveSeconds = Math.max(MIN_WINDOW_SECONDS, safeRequested);
  // Floor to whole minutes (complete-minute denominator).
  const windowMinutes = Math.max(1, Math.floor(effectiveSeconds / 60));
  const to = floorToMinute(now);
  const from = new Date(to.getTime() - windowMinutes * 60_000);
  const readTo = new Date(to.getTime() + 60_000);
  return { from, to, readTo, windowMinutes };
}

/** The window-metrics collector's per-run result (all numeric, assertable). */
export interface WindowMetricsResult {
  totalCount: number;
  fatalCount: number;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  debugCount: number;
  /** (error + fatal) lines per minute over the window. */
  errorRatePerMinute: number;
  /**
   * Whole seconds since the stream last received ANY line. When the stream has
   * never received a line, this is the seconds since the stream was created
   * (NOT a sentinel), so an absence assertion is meaningful from creation.
   */
  secondsSinceLastLog: number;
  /** Distinct Drain templates first observed within the window. */
  newPatternCount: number;
  /** Distinct Drain templates with any occurrence in the window. */
  distinctPatternCount: number;
}

/**
 * Whole seconds between `now` and the more recent of `lastReceivedAt` /
 * `streamCreatedAt`. Never-received streams fall back to age-since-creation.
 * Clamped at 0 so a slightly-future `lastReceivedAt` (clock skew) reads as 0.
 */
export function computeSecondsSinceLastLog({
  now,
  lastReceivedAt,
  streamCreatedAt,
}: {
  now: Date;
  lastReceivedAt: Date | null;
  streamCreatedAt: Date;
}): number {
  const reference = lastReceivedAt ?? streamCreatedAt;
  return Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1000));
}

/**
 * Assemble the window-metrics result from already-read aggregates. Pure: all
 * IO is done by the caller. `severity` carries the six banded sums over the
 * window; `trace` folds into `totalCount` only (no dedicated field).
 */
export function buildWindowMetrics({
  severity,
  newPatternCount,
  distinctPatternCount,
  now,
  lastReceivedAt,
  streamCreatedAt,
  windowMinutes,
}: {
  severity: StreamSeverityTotals;
  newPatternCount: number;
  distinctPatternCount: number;
  now: Date;
  lastReceivedAt: Date | null;
  streamCreatedAt: Date;
  windowMinutes: number;
}): WindowMetricsResult {
  const totalCount =
    severity.trace +
    severity.debug +
    severity.info +
    severity.warn +
    severity.error +
    severity.fatal;
  const errorPlusFatal = severity.error + severity.fatal;
  const minutes = Math.max(1, windowMinutes);
  return {
    totalCount,
    fatalCount: severity.fatal,
    errorCount: severity.error,
    warnCount: severity.warn,
    infoCount: severity.info,
    debugCount: severity.debug,
    errorRatePerMinute: round2(errorPlusFatal / minutes),
    secondsSinceLastLog: computeSecondsSinceLastLog({
      now,
      lastReceivedAt,
      streamCreatedAt,
    }),
    newPatternCount,
    distinctPatternCount,
  };
}

/** The pattern-occurrence collector's per-run result. */
export interface PatternOccurrenceResult {
  /** Occurrences of the pattern over the window. */
  occurrenceCount: number;
  /**
   * Whole minutes since the pattern was last seen. Falls back to
   * minutes-since-stream-creation when the pattern has never been recorded.
   */
  minutesSinceLastSeen: number;
}

/** Assemble the pattern-occurrence result from already-read aggregates. */
export function buildPatternOccurrence({
  occurrenceCount,
  now,
  lastSeenAt,
  streamCreatedAt,
}: {
  occurrenceCount: number;
  now: Date;
  lastSeenAt: Date | null;
  streamCreatedAt: Date;
}): PatternOccurrenceResult {
  const reference = lastSeenAt ?? streamCreatedAt;
  const minutesSinceLastSeen = Math.max(
    0,
    Math.floor((now.getTime() - reference.getTime()) / 60_000),
  );
  return { occurrenceCount, minutesSinceLastSeen };
}

/** The pattern-metric collector's per-run result (all numeric, assertable). */
export interface PatternMetricResult {
  /**
   * Mean of the numeric `<*>` values seen over the window. The value's unit is
   * unknown to the platform (it is whatever the logged number means - ms, bytes,
   * a count); assert against a threshold you know for that field. `0` when the
   * window had no numeric samples.
   */
  avgValue: number;
  /** Minimum numeric value over the window; `0` when there were no samples. */
  minValue: number;
  /** Maximum numeric value over the window; `0` when there were no samples. */
  maxValue: number;
  /**
   * How many numeric samples the window covered. `0` means the pattern matched
   * no lines with a numeric value at this position in the window - assert on
   * `sampleCount > 0` alongside a value assertion so a quiet window (which
   * reports `avg/min/max = 0`) is not mistaken for a real zero reading.
   */
  sampleCount: number;
}

/**
 * Assemble the pattern-metric result from a windowed variable aggregate. Pure:
 * the DB read is done by the caller. A zero-sample window yields zeroed
 * value fields (healthcheck result fields must be numbers, never null); the
 * `sampleCount` field lets an assertion distinguish "no data" from a true zero.
 */
export function buildPatternMetric({
  window,
}: {
  window: PatternVariableWindow;
}): PatternMetricResult {
  const sampleCount = window.sampleCount;
  const avgValue = sampleCount > 0 ? round2(window.sum / sampleCount) : 0;
  return {
    avgValue,
    minValue: window.min ?? 0,
    maxValue: window.max ?? 0,
    sampleCount,
  };
}

/** Round to 2 decimals to keep rate metrics tidy for charts/assertions. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
