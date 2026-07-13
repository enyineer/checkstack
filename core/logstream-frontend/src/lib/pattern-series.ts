import type {
  BucketGrain,
  PatternBucketPoint,
} from "@checkstack/logstream-common";
import type { SeriesPoint } from "@checkstack/ui";

const GRAIN_MS: Record<BucketGrain, number> = {
  minute: 60_000,
  hour: 3_600_000,
};

/**
 * Safety cap on zero-filled buckets. The backend's grain auto-pick keeps real
 * windows far below this (minute grain only up to 3h = 180 buckets; a 30-day
 * hourly window = 721); beyond the cap we fall back to sparse points rather
 * than build a pathological array.
 */
const MAX_FILLED_BUCKETS = 2000;

/**
 * Fold pattern-occurrence bucket points for ONE pattern into an oldest-first,
 * ZERO-FILLED `SeriesPoint[]` for the `TimeSeriesChart`, spanning every bucket
 * of `[from, to]` at the response's grain.
 *
 * Zero-filling matters twice over: an empty bucket genuinely means zero
 * occurrences (sparse points would draw a misleading line between distant
 * spikes), and `TimeSeriesChart` renders polylines only - a window whose
 * matches collapse into a single bucket would otherwise produce a one-point
 * polyline, which draws NOTHING (the original "empty chart with a y-axis"
 * bug).
 *
 * `getPatternBuckets` returns points for every pattern in the window (the
 * contract has no per-pattern filter), so the caller passes the focal
 * `patternId` and this keeps only its points, summing per `bucketStart`
 * (defensive - there is normally one point per bucket per pattern). Pure so
 * the shaping is unit-tested without a DOM.
 */
export function toPatternSeries({
  points,
  patternId,
  grain,
  from,
  to,
}: {
  points: PatternBucketPoint[];
  patternId: string;
  grain: BucketGrain;
  from: Date;
  to: Date;
}): SeriesPoint[] {
  const span = GRAIN_MS[grain];
  const byStart = new Map<number, number>();
  for (const point of points) {
    if (point.patternId !== patternId) continue;
    const start = new Date(point.bucketStart).getTime();
    byStart.set(start, (byStart.get(start) ?? 0) + point.count);
  }

  const firstBucket = Math.floor(from.getTime() / span) * span;
  const lastBucket = Math.floor(to.getTime() / span) * span;
  const bucketCount = Math.floor((lastBucket - firstBucket) / span) + 1;

  if (bucketCount <= 1 || bucketCount > MAX_FILLED_BUCKETS) {
    // Degenerate or pathological window: return the sparse sorted points.
    return [...byStart.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([x, y]) => ({ x, y }));
  }

  const out: SeriesPoint[] = [];
  for (let x = firstBucket; x <= lastBucket; x += span) {
    out.push({ x, y: byStart.get(x) ?? 0 });
  }
  return out;
}

/** The bucket width (ms) for a grain - exported for callers that annotate spans. */
export function patternGrainSpanMs(grain: BucketGrain): number {
  return GRAIN_MS[grain];
}
