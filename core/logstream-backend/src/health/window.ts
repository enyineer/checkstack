/**
 * Metric assembly for the log-stream health collectors. The complete-minute
 * window math + seconds-since-last helper are shared across the observability
 * plugins and live in `@checkstack/healthcheck-common` (`health-window.ts`);
 * this file keeps only the log-specific result shapes + `build*` assembly. Pure
 * / IO-free (the DB reads live in `./reader`).
 */

import type {
  StreamSeverityTotals,
  PatternVariableWindow,
} from "@checkstack/logstream-common";
import { computeSecondsSinceLast } from "@checkstack/healthcheck-common";

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
    secondsSinceLastLog: computeSecondsSinceLast({
      now,
      lastAt: lastReceivedAt,
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
