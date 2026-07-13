import type {
  BucketGrain,
  MetricBucketPoint,
} from "@checkstack/metricstream-common";
import type { SeriesPoint } from "@checkstack/ui";

const GRAIN_MS: Record<BucketGrain, number> = {
  minute: 60_000,
  hour: 3_600_000,
};

/**
 * Safety cap on the number of axis buckets. The backend's grain auto-pick keeps
 * real windows far below this (minute grain only for short windows; a 30-day
 * hourly window = 721 buckets); beyond the cap we fall back to sparse points
 * rather than build a pathological array.
 */
const MAX_FILLED_BUCKETS = 3000;

/** The value a chart line reads from one aggregated bucket. */
export type MetricBucketField = "avg" | "min" | "max" | "last";

/**
 * Read one aggregated bucket's value for a given line. `avg` divides the summed
 * value by the sample count (null when the bucket carried no samples - a gap,
 * NOT a zero); `min`/`max`/`last` pass through the stored aggregate (already
 * null when the bucket had no samples).
 *
 * IMPORTANT (deviation from logstream's zero-fill): a metric line NULL-fills
 * absent buckets, it does not zero-fill them. Log occurrences are counts where
 * an empty bucket genuinely means zero; a gauge's average over an empty minute
 * is "no sample", and drawing it as 0 would misrepresent the metric. We still
 * reuse logstream's FULL-AXIS construction so bucket spacing stays honest and a
 * single populated bucket is positioned correctly.
 */
export function readBucketValue({
  point,
  field,
}: {
  point: MetricBucketPoint;
  field: MetricBucketField;
}): number | null {
  switch (field) {
    case "avg": {
      return point.count > 0 ? point.sum / point.count : null;
    }
    case "min": {
      return point.min;
    }
    case "max": {
      return point.max;
    }
    case "last": {
      return point.last;
    }
  }
}

/**
 * Fold windowed metric buckets into an oldest-first `SeriesPoint[]` for the
 * `TimeSeriesChart`, spanning every bucket of `[from, to]` at the response's
 * grain. Absent buckets carry `y: null` (a gap, drawn as a break in the line),
 * present buckets carry the selected field's value. Pure so the shaping is
 * unit-tested without a DOM.
 */
export function toMetricSeries({
  points,
  grain,
  from,
  to,
  field,
}: {
  points: MetricBucketPoint[];
  grain: BucketGrain;
  from: Date;
  to: Date;
  field: MetricBucketField;
}): SeriesPoint[] {
  const span = GRAIN_MS[grain];
  const byStart = new Map<number, number | null>();
  for (const point of points) {
    const start = new Date(point.bucketStart).getTime();
    byStart.set(start, readBucketValue({ point, field }));
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
    out.push({ x, y: byStart.has(x) ? (byStart.get(x) ?? null) : null });
  }
  return out;
}

/** True when a series has at least one real (non-null) sample to draw. */
export function hasMetricSamples(points: ReadonlyArray<SeriesPoint>): boolean {
  return points.some((p) => p.y !== null && p.y !== undefined);
}

/** The bucket width (ms) for a grain - exported for callers that annotate spans. */
export function metricGrainSpanMs(grain: BucketGrain): number {
  return GRAIN_MS[grain];
}
