/**
 * Pure window math + result assembly for the `metric-window` collector.
 *
 * The health evaluation is a cheap periodic read of pre-aggregated minute
 * buckets - never a per-datapoint computation. These functions are IO-free so
 * the complete-minute + in-progress-minute semantics, the multi-series folds,
 * and the read-time counter rate math (with reset detection and the delta
 * flavor) can be unit-tested without a database (the DB reads live in
 * `./reader`).
 */

import type {
  CounterKind,
  MetricType,
  MetricWindowResult,
} from "@checkstack/metricstream-common";
import type {
  SeriesWindowAggregate,
  SeriesCumulativePoint,
} from "../storage";
import { floorToMinute } from "../storage";

/** Absolute floor on a health window: one whole minute. */
export const MIN_WINDOW_SECONDS = 60;

/** A resolved evaluation window over minute buckets. */
export interface WindowBounds {
  /** Inclusive start of the window (minute-aligned). */
  from: Date;
  /**
   * Exclusive end of the COMPLETE-minute window: the start of the minute
   * containing `now`. Used as the rate denominator boundary (`windowMinutes`
   * whole minutes).
   */
  to: Date;
  /**
   * Exclusive end for the count/aggregate reads: the end of the in-progress
   * minute (`to + 1 minute`). Reading `[from, readTo)` additively includes the
   * current partial minute so a burst seconds into the minute is visible to a
   * same-tick evaluation. Bucket sums are monotonic within a minute, so
   * including partial data can only surface a threshold sooner, never report a
   * false low.
   */
  readTo: Date;
  /** Whole COMPLETE minutes spanned by `[from, to)` (>= 1). */
  windowMinutes: number;
}

/**
 * Resolve the evaluation window. `windowSeconds` defaults to the check's
 * interval, is floored to a whole number of minutes, and is clamped to at least
 * one minute. The complete-minute window ends at the last COMPLETE minute
 * (`to`); the aggregate reads additionally include the in-progress minute
 * (`readTo`).
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
    Number.isFinite(requested) && requested > 0 ? requested : MIN_WINDOW_SECONDS;
  const effectiveSeconds = Math.max(MIN_WINDOW_SECONDS, safeRequested);
  const windowMinutes = Math.max(1, Math.floor(effectiveSeconds / 60));
  const to = floorToMinute(now);
  const from = new Date(to.getTime() - windowMinutes * 60_000);
  const readTo = new Date(to.getTime() + 60_000);
  return { from, to, readTo, windowMinutes };
}

/**
 * Whole seconds between `now` and the more recent of the selection's last
 * sample / the stream's creation. A never-seen selection falls back to
 * age-since-creation (NOT a sentinel), so an absence assertion like
 * `secondsSinceLastSample < 600` is meaningful from creation (the logstream
 * staleness lesson). Clamped at 0 so a slightly-future timestamp (clock skew)
 * reads as 0.
 */
export function computeSecondsSinceLastSample({
  now,
  lastSampleAt,
  streamCreatedAt,
}: {
  now: Date;
  lastSampleAt: Date | null;
  streamCreatedAt: Date;
}): number {
  const reference = lastSampleAt ?? streamCreatedAt;
  return Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1000));
}

/**
 * Sum the read-time INCREASE of a cumulative counter across every matching
 * series over the window. Points are ordered by series then bucket; within one
 * series, successive cumulative `last` values are differenced. A DECREASE marks
 * a counter RESET (a restart / rollover): the post-reset value is itself the
 * increment (`delta = next.last`), never a negative number. Only positive
 * deltas contribute, so the total is monotonic. Returns 0 for a series with
 * fewer than two points (no interval to measure).
 */
export function sumCumulativeIncrease(points: SeriesCumulativePoint[]): number {
  let increase = 0;
  let prevSeriesId: string | null = null;
  let prevLast = 0;
  for (const point of points) {
    if (point.seriesId !== prevSeriesId) {
      // First point of a new series: establishes the baseline, no increment.
      prevSeriesId = point.seriesId;
      prevLast = point.last;
      continue;
    }
    increase += point.last < prevLast ? point.last : point.last - prevLast;
    prevLast = point.last;
  }
  return increase;
}

/**
 * Derive `{ ratePerSecond, increase }` for the selection over the window.
 *
 * - GAUGES (and any non-counter): both 0 - rate/increase are counters-only (the
 *   result-field `.describe()` says so).
 * - DELTA counters: the window's summed per-interval increments
 *   (`aggregate.deltaSum`) ARE the increase; rate divides by the window.
 * - CUMULATIVE counters: the increase is the reset-aware sum of successive
 *   cumulative diffs (`sumCumulativeIncrease`).
 *
 * The rate denominator is the COMPLETE-minute window (`windowMinutes * 60`), so
 * a partial in-progress minute cannot deflate the elapsed time.
 */
export function computeCounterRate({
  metricType,
  counterKind,
  aggregate,
  cumulativePoints,
  windowMinutes,
}: {
  metricType: MetricType | null;
  counterKind: CounterKind | null;
  aggregate: SeriesWindowAggregate;
  cumulativePoints: SeriesCumulativePoint[];
  windowMinutes: number;
}): { ratePerSecond: number; increase: number } {
  if (metricType !== "counter") return { ratePerSecond: 0, increase: 0 };
  const increase =
    counterKind === "delta"
      ? aggregate.deltaSum
      : sumCumulativeIncrease(cumulativePoints);
  const windowSeconds = Math.max(1, windowMinutes) * 60;
  return {
    ratePerSecond: round4(increase / windowSeconds),
    increase: round4(increase),
  };
}

/**
 * Assemble the `metric-window` result from already-read aggregates. Pure: all
 * IO is done by the caller. Multi-series folds: `min` of mins, `max` of maxs,
 * sum-weighted `avg` (sum / sampleCount), `last` = the latest sample by
 * `lastTs`. A window with no samples yields zeroed value fields (healthcheck
 * result fields must be numbers, never null); `sampleCount`/`seriesCount` let an
 * assertion tell "no data" apart from a genuine zero reading.
 */
export function buildMetricWindowResult({
  aggregate,
  metricType,
  counterKind,
  cumulativePoints,
  windowMinutes,
  now,
  lastSampleAt,
  streamCreatedAt,
}: {
  aggregate: SeriesWindowAggregate;
  metricType: MetricType | null;
  counterKind: CounterKind | null;
  cumulativePoints: SeriesCumulativePoint[];
  windowMinutes: number;
  now: Date;
  lastSampleAt: Date | null;
  streamCreatedAt: Date;
}): MetricWindowResult {
  const sampleCount = aggregate.sampleCount;
  const avgValue = sampleCount > 0 ? round4(aggregate.sum / sampleCount) : 0;
  const { ratePerSecond, increase } = computeCounterRate({
    metricType,
    counterKind,
    aggregate,
    cumulativePoints,
    windowMinutes,
  });
  return {
    lastValue: aggregate.last ?? 0,
    avgValue,
    minValue: aggregate.min ?? 0,
    maxValue: aggregate.max ?? 0,
    sampleCount,
    seriesCount: aggregate.seriesCount,
    ratePerSecond,
    increase,
    secondsSinceLastSample: computeSecondsSinceLastSample({
      now,
      lastSampleAt,
      streamCreatedAt,
    }),
  };
}

/** Round to 4 decimals to keep rate metrics tidy for charts/assertions. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
