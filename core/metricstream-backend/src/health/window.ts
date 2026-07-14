/**
 * Result assembly for the `metric-window` collector. The complete-minute window
 * math + seconds-since-last helper are shared across the observability plugins
 * and live in `@checkstack/healthcheck-common` (`health-window.ts`); this file
 * keeps only the metric-specific folds (multi-series aggregation, the read-time
 * counter rate math with reset detection + delta flavor) and result assembly.
 * IO-free (the DB reads live in `./reader`).
 */

import type {
  CounterKind,
  MetricType,
  MetricWindowResult,
} from "@checkstack/metricstream-common";
import { computeSecondsSinceLast } from "@checkstack/healthcheck-common";
import type {
  SeriesWindowAggregate,
  SeriesCumulativePoint,
} from "../storage";

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
    secondsSinceLastSample: computeSecondsSinceLast({
      now,
      lastAt: lastSampleAt,
      streamCreatedAt,
    }),
  };
}

/** Round to 4 decimals to keep rate metrics tidy for charts/assertions. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
