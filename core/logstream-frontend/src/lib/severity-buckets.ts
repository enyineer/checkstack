import type {
  BucketGrain,
  SeverityBucketPoint,
} from "@checkstack/logstream-common";
import type { StackedBucket, StackTone } from "@checkstack/ui";
import { severityBandToStackTone } from "./severity-tone";

const GRAIN_MS: Record<BucketGrain, number> = {
  minute: 60_000,
  hour: 3_600_000,
};

/** Tone labels for the severity `StackedTimeline` (the health wording is wrong here). */
export const SEVERITY_STACK_LABELS: Partial<Record<StackTone, string>> = {
  down: "Error / Fatal",
  warn: "Warn",
  ok: "Info",
  unknown: "Debug / Trace",
};

/**
 * Fold per-band severity bucket points into the `StackedTimeline`'s
 * `StackedBucket[]` (oldest-first), collapsing the six bands into the three
 * visible stacks. Pure so the chart data shaping is unit-tested.
 */
export function toStackedBuckets({
  points,
  grain,
}: {
  points: SeverityBucketPoint[];
  grain: BucketGrain;
}): StackedBucket[] {
  const spanMs = GRAIN_MS[grain];
  const byStart = new Map<number, Partial<Record<StackTone, number>>>();

  for (const point of points) {
    const start = new Date(point.bucketStart).getTime();
    const tone = severityBandToStackTone(point.band);
    const counts = byStart.get(start) ?? {};
    counts[tone] = (counts[tone] ?? 0) + point.count;
    byStart.set(start, counts);
  }

  return [...byStart.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([start, counts]) => ({ start, end: start + spanMs, counts }));
}
