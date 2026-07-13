/**
 * Windowed bucket reads + cross-tier merge for the `getMetricBuckets` chart
 * endpoint. A point is one aggregated bucket across ALL series matching a
 * `(metricName, labelFilters)` selection, at one tier. When a wide window is
 * requested at HOUR grain, the part older than the minute-retention boundary
 * comes from the hourly tier and the still-fine recent part is folded from the
 * minute tier, then merged - mirroring the logstream buckets-merge precedent.
 *
 * The pure helpers (grain choice, boundary partition, hour fold, merge) are
 * unit-tested; the grouped DB reads run under the API service.
 */

import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, asc, desc, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  BucketGrain,
  MetricBucketPoint,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricMinuteBuckets, metricHourlyBuckets } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE, floorToHour } from "../storage";

// The tier-partition helpers live in storage/time (pure, shared with the health
// reader); re-exported here so the chart endpoint + its tests keep one import.
export { rollupBoundary, partitionWindowAtBoundary } from "../storage";

type Runner = ScopedQueryRunner<typeof schema>;

/** Above this window width, default to hour grain (minute detail is too dense). */
export const MINUTE_TIER_MAX_MS = 6 * 3_600_000;

/** Choose the read tier: explicit wins, else by window width. Pure. */
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
  return to.getTime() - from.getTime() <= MINUTE_TIER_MAX_MS ? "minute" : "hour";
}

/** Fold minute-grain points into hour buckets (for the fine part at hour grain). Pure. */
export function foldMetricPointsByHour(
  points: MetricBucketPoint[],
): MetricBucketPoint[] {
  const byHour = new Map<number, MetricBucketPoint>();
  const bestLastTs = new Map<number, number>();
  for (const p of points) {
    const hour = floorToHour(p.bucketStart).getTime();
    const existing = byHour.get(hour);
    if (!existing) {
      byHour.set(hour, { ...p, bucketStart: new Date(hour) });
      bestLastTs.set(hour, p.lastTs?.getTime() ?? -Infinity);
      continue;
    }
    existing.count += p.count;
    existing.sum += p.sum;
    existing.deltaSum += p.deltaSum;
    if (p.min !== null) {
      existing.min = existing.min === null ? p.min : Math.min(existing.min, p.min);
    }
    if (p.max !== null) {
      existing.max = existing.max === null ? p.max : Math.max(existing.max, p.max);
    }
    const pLastTs = p.lastTs?.getTime() ?? -Infinity;
    if (pLastTs >= (bestLastTs.get(hour) ?? -Infinity)) {
      existing.last = p.last;
      existing.lastTs = p.lastTs;
      bestLastTs.set(hour, pLastTs);
    }
  }
  return [...byHour.values()].toSorted(
    (a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
  );
}

/** Merge two point arrays folding identical `bucketStart`s (same fold rules). Pure. */
export function mergeMetricPoints(
  a: MetricBucketPoint[],
  b: MetricBucketPoint[],
): MetricBucketPoint[] {
  return foldByBucketStart([...a, ...b]);
}

/** Fold points sharing an exact `bucketStart` (used when merging tiers). Pure. */
function foldByBucketStart(points: MetricBucketPoint[]): MetricBucketPoint[] {
  const byBucket = new Map<number, MetricBucketPoint>();
  const bestLastTs = new Map<number, number>();
  for (const p of points) {
    const key = p.bucketStart.getTime();
    const existing = byBucket.get(key);
    if (!existing) {
      byBucket.set(key, { ...p });
      bestLastTs.set(key, p.lastTs?.getTime() ?? -Infinity);
      continue;
    }
    existing.count += p.count;
    existing.sum += p.sum;
    existing.deltaSum += p.deltaSum;
    if (p.min !== null) {
      existing.min = existing.min === null ? p.min : Math.min(existing.min, p.min);
    }
    if (p.max !== null) {
      existing.max = existing.max === null ? p.max : Math.max(existing.max, p.max);
    }
    const pLastTs = p.lastTs?.getTime() ?? -Infinity;
    if (pLastTs >= (bestLastTs.get(key) ?? -Infinity)) {
      existing.last = p.last;
      existing.lastTs = p.lastTs;
      bestLastTs.set(key, pLastTs);
    }
  }
  return [...byBucket.values()].toSorted(
    (a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
  );
}

function bucketTable(grain: BucketGrain) {
  return grain === "hour" ? metricHourlyBuckets : metricMinuteBuckets;
}

/**
 * Read per-bucket points aggregated across `seriesIds` over `[from, to)` at one
 * tier. Two grouped reads folded by `bucketStart`: the additive/extrema
 * aggregate, and the latest sample (`last`/`lastTs` by newest `lastTs`). Chunked
 * over the series id set (partial per-chunk aggregates are folded in memory).
 */
export async function readBucketPoints({
  runner,
  seriesIds,
  from,
  to,
  grain,
}: {
  runner: Runner;
  seriesIds: string[];
  from: Date;
  to: Date;
  grain: BucketGrain;
}): Promise<MetricBucketPoint[]> {
  if (seriesIds.length === 0) return [];
  const table = bucketTable(grain);

  const byBucket = new Map<number, MetricBucketPoint>();
  const bestLastTs = new Map<number, number>();
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    const where = and(
      inArray(table.seriesId, part),
      gte(table.bucketStart, from),
      lt(table.bucketStart, to),
    );
    const aggRows = await runner
      .select({
        bucketStart: table.bucketStart,
        count: sql<string>`coalesce(sum(${table.count}), 0)`,
        sum: sql<string>`coalesce(sum(${table.sum}), 0)`,
        min: sql<string | null>`min(${table.min})`,
        max: sql<string | null>`max(${table.max})`,
        deltaSum: sql<string>`coalesce(sum(${table.deltaSum}), 0)`,
      })
      .from(table)
      .where(where)
      .groupBy(table.bucketStart);

    for (const r of aggRows) {
      const key = r.bucketStart.getTime();
      const existing = byBucket.get(key);
      const point: MetricBucketPoint = {
        bucketStart: r.bucketStart,
        count: Number(r.count),
        sum: Number(r.sum),
        min: r.min === null ? null : Number(r.min),
        max: r.max === null ? null : Number(r.max),
        last: null,
        lastTs: null,
        deltaSum: Number(r.deltaSum),
      };
      if (existing) {
        existing.count += point.count;
        existing.sum += point.sum;
        existing.deltaSum += point.deltaSum;
        if (point.min !== null) {
          existing.min =
            existing.min === null ? point.min : Math.min(existing.min, point.min);
        }
        if (point.max !== null) {
          existing.max =
            existing.max === null ? point.max : Math.max(existing.max, point.max);
        }
      } else {
        byBucket.set(key, point);
      }
    }

    // Latest sample per bucket across this chunk (DISTINCT ON bucket, newest ts).
    const lastRows = await runner
      .selectDistinctOn([table.bucketStart], {
        bucketStart: table.bucketStart,
        last: table.last,
        lastTs: table.lastTs,
      })
      .from(table)
      .where(where)
      .orderBy(asc(table.bucketStart), desc(table.lastTs));
    for (const r of lastRows) {
      const key = r.bucketStart.getTime();
      const tsMs = r.lastTs.getTime();
      if (tsMs >= (bestLastTs.get(key) ?? -Infinity)) {
        bestLastTs.set(key, tsMs);
        const point = byBucket.get(key);
        if (point) {
          point.last = r.last;
          point.lastTs = r.lastTs;
        }
      }
    }
  }

  return [...byBucket.values()].toSorted(
    (a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
  );
}
