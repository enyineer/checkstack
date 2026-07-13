import type {
  SeverityBucketPoint,
  PatternBucketPoint,
  BucketGrain,
  StreamSeverityTotals,
} from "@checkstack/logstream-common";
import { SEVERITY_BANDS } from "@checkstack/logstream-common";
import { floorToHour } from "../storage/time";

/**
 * Pure cross-tier bucket merge helpers for the chart/overview reads. Minute
 * buckets carry the recent window (kept for `minuteRetentionHours`) and are
 * rolled up into the hourly tables by the retention job (which deletes the
 * rolled minute rows). So for an HOUR-grain read the timeline splits cleanly at
 * a boundary: everything older than `now - minuteRetentionHours` lives in the
 * hourly tables, everything newer lives in the minute tables only. This module
 * partitions a requested window at that boundary and folds the minute side up
 * to whole hours so a single hour-grain series can be returned.
 *
 * No IO here (the service supplies the rows via the storage read helpers) so the
 * partition + fold math is unit-tested in isolation.
 */

/** Auto-pick minute grain for windows up to this width; hour grain beyond it. */
export const AUTO_MINUTE_MAX_MS = 3 * 60 * 60 * 1000;

/** A half-open `[from, to)` sub-window. */
export interface BucketRange {
  from: Date;
  to: Date;
}

/**
 * Resolve the grain for a bucket read: honor an explicit grain, else pick
 * minute for narrow windows and hour for wide ones (keeps the point count and
 * response size bounded on long ranges).
 */
export function resolveGrain({
  from,
  to,
  explicit,
}: {
  from: Date;
  to: Date;
  explicit?: BucketGrain;
}): BucketGrain {
  if (explicit) return explicit;
  return to.getTime() - from.getTime() <= AUTO_MINUTE_MAX_MS
    ? "minute"
    : "hour";
}

/**
 * The hourly rollup boundary: minute rows older than this have been rolled into
 * the hourly tables and deleted, so an hour-grain read takes the older side from
 * the hourly tables and the newer side (folded to hours) from the minute tables.
 */
export function rollupBoundary({
  now,
  minuteRetentionHours,
}: {
  now: Date;
  minuteRetentionHours: number;
}): Date {
  return floorToHour(new Date(now.getTime() - minuteRetentionHours * 3_600_000));
}

/**
 * Split a `[from, to)` window at the rollup boundary into the coarse (hourly
 * table) sub-window and the fine (minute table) sub-window. Either side may be
 * `null` when the whole window falls on the other side of the boundary. The two
 * ranges are disjoint and together cover `[from, to)`.
 */
export function partitionWindowAtBoundary({
  from,
  to,
  boundary,
}: {
  from: Date;
  to: Date;
  boundary: Date;
}): { coarse: BucketRange | null; fine: BucketRange | null } {
  const coarseToMs = Math.min(to.getTime(), boundary.getTime());
  const fineFromMs = Math.max(from.getTime(), boundary.getTime());
  const coarse =
    from.getTime() < coarseToMs
      ? { from, to: new Date(coarseToMs) }
      : null;
  const fine =
    fineFromMs < to.getTime() ? { from: new Date(fineFromMs), to } : null;
  return { coarse, fine };
}

/**
 * Fold a mix of hour-aligned (coarse) and minute-grain (fine) severity points
 * into one hour-grain series: floor every point to its hour and sum counts per
 * `(hour, band)`. Coarse points are already hour-aligned so flooring is a no-op
 * for them; a transient minute/hour overlap (never expected once the retention
 * job has run) would sum rather than double the same physical row, which is the
 * safe direction. Sorted ascending by bucket then band.
 */
export function sumSeverityPointsByHour(
  points: SeverityBucketPoint[],
): SeverityBucketPoint[] {
  const byKey = new Map<string, SeverityBucketPoint>();
  for (const point of points) {
    const hour = floorToHour(point.bucketStart);
    const key = `${hour.getTime()}|${point.band}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += point.count;
    } else {
      byKey.set(key, {
        bucketStart: hour,
        band: point.band,
        count: point.count,
      });
    }
  }
  return [...byKey.values()].toSorted(
    (a, b) =>
      a.bucketStart.getTime() - b.bucketStart.getTime() ||
      SEVERITY_BANDS.indexOf(a.band) - SEVERITY_BANDS.indexOf(b.band),
  );
}

/**
 * Fold a mix of hour-aligned and minute-grain pattern points into one hour-grain
 * series: floor to the hour and sum counts per `(hour, patternId)`. Sorted
 * ascending by bucket then patternId.
 */
export function sumPatternPointsByHour(
  points: PatternBucketPoint[],
): PatternBucketPoint[] {
  const byKey = new Map<string, PatternBucketPoint>();
  for (const point of points) {
    const hour = floorToHour(point.bucketStart);
    const key = `${hour.getTime()}|${point.patternId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += point.count;
    } else {
      byKey.set(key, {
        bucketStart: hour,
        patternId: point.patternId,
        count: point.count,
      });
    }
  }
  return [...byKey.values()].toSorted(
    (a, b) =>
      a.bucketStart.getTime() - b.bucketStart.getTime() ||
      (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0),
  );
}

/** Add two severity-total records band-by-band (used to fold cross-tier sums). */
export function addSeverityTotals(
  a: StreamSeverityTotals,
  b: StreamSeverityTotals,
): StreamSeverityTotals {
  return {
    trace: a.trace + b.trace,
    debug: a.debug + b.debug,
    info: a.info + b.info,
    warn: a.warn + b.warn,
    error: a.error + b.error,
    fatal: a.fatal + b.fatal,
  };
}

/** A zeroed severity-total record. */
export const ZERO_SEVERITY_TOTALS: StreamSeverityTotals = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};
