import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, asc, gte, inArray, lt, sql } from "drizzle-orm";
import type { BucketGrain } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricMinuteBuckets, metricHourlyBuckets } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

/** A minute-bucket delta for one series (folded into the bucket on conflict). */
export interface MinuteBucketDelta {
  seriesId: string;
  bucketStart: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
  /** The value of the latest sample folded into this bucket... */
  last: number;
  /** ...and that sample's timestamp (drives latest-lastTs-wins for `last`). */
  lastTs: Date;
  /** Delta-counter increments summed into this bucket (0 for gauges/cumulative). */
  deltaSum: number;
}

function bucketTable(grain: BucketGrain) {
  return grain === "hour" ? metricHourlyBuckets : metricMinuteBuckets;
}

/**
 * Accumulate per-series minute buckets:
 * `INSERT ... ON CONFLICT (series_id, bucket_start) DO UPDATE` folding
 * `count += `, `sum += `, `min = least(...)`, `max = greatest(...)`,
 * `delta_sum += `, and - crucially - `last`/`last_ts` with LATEST-lastTs-wins:
 * `last` is only overwritten by the incoming sample when its `last_ts` is newer
 * than the stored one, and `last_ts` advances to the greater of the two. This is
 * what makes the last-value read correct regardless of flush/pod ordering.
 * Multi-row, chunked; run inside the flush transaction.
 */
export async function upsertMinuteBuckets({
  runner,
  deltas,
}: {
  runner: Runner;
  deltas: MinuteBucketDelta[];
}): Promise<void> {
  if (deltas.length === 0) return;
  for (const part of chunk({ items: deltas, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(metricMinuteBuckets)
      .values(part)
      .onConflictDoUpdate({
        target: [metricMinuteBuckets.seriesId, metricMinuteBuckets.bucketStart],
        set: {
          count: sql`${metricMinuteBuckets.count} + excluded."count"`,
          sum: sql`${metricMinuteBuckets.sum} + excluded."sum"`,
          min: sql`least(${metricMinuteBuckets.min}, excluded."min")`,
          max: sql`greatest(${metricMinuteBuckets.max}, excluded."max")`,
          deltaSum: sql`${metricMinuteBuckets.deltaSum} + excluded.delta_sum`,
          last: sql`case when excluded.last_ts >= ${metricMinuteBuckets.lastTs} then excluded."last" else ${metricMinuteBuckets.last} end`,
          lastTs: sql`greatest(${metricMinuteBuckets.lastTs}, excluded.last_ts)`,
        },
      });
  }
}

/** Windowed aggregate across a set of series at one tier - the collector read. */
export interface SeriesWindowAggregate {
  /** Number of samples folded across all matching buckets. */
  sampleCount: number;
  sum: number;
  min: number | null;
  max: number | null;
  /** Latest sample value across the window, by `lastTs`. */
  last: number | null;
  lastTs: Date | null;
  /** Summed delta-counter increments across the window. */
  deltaSum: number;
  /** Distinct matching series that had data in the window. */
  seriesCount: number;
}

/**
 * Aggregate all buckets of `seriesIds` over `[from, to)` at one tier into a
 * single window summary. `min`/`max`/`last` are null when the window had no
 * samples. The caller composes cross-tier windows (minute + hour) by summing
 * both tiers over their respective sub-ranges. Chunked over the series id set.
 */
export async function readWindowAggregate({
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
}): Promise<SeriesWindowAggregate> {
  const empty: SeriesWindowAggregate = {
    sampleCount: 0,
    sum: 0,
    min: null,
    max: null,
    last: null,
    lastTs: null,
    deltaSum: 0,
    seriesCount: 0,
  };
  if (seriesIds.length === 0) return empty;
  const table = bucketTable(grain);

  const acc: SeriesWindowAggregate = { ...empty };
  let bestLastTs: Date | null = null;
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    const where = and(
      inArray(table.seriesId, part),
      gte(table.bucketStart, from),
      lt(table.bucketStart, to),
    );
    const [agg] = await runner
      .select({
        sampleCount: sql<string>`coalesce(sum(${table.count}), 0)`,
        sum: sql<string>`coalesce(sum(${table.sum}), 0)`,
        min: sql<string | null>`min(${table.min})`,
        max: sql<string | null>`max(${table.max})`,
        deltaSum: sql<string>`coalesce(sum(${table.deltaSum}), 0)`,
        seriesCount: sql<string>`count(distinct ${table.seriesId})`,
      })
      .from(table)
      .where(where);
    acc.sampleCount += Number(agg?.sampleCount ?? 0);
    acc.sum += Number(agg?.sum ?? 0);
    acc.deltaSum += Number(agg?.deltaSum ?? 0);
    acc.seriesCount += Number(agg?.seriesCount ?? 0);
    if (agg?.min != null) {
      const v = Number(agg.min);
      acc.min = acc.min === null ? v : Math.min(acc.min, v);
    }
    if (agg?.max != null) {
      const v = Number(agg.max);
      acc.max = acc.max === null ? v : Math.max(acc.max, v);
    }

    // Latest sample by lastTs across the window (small ordered lookup per chunk).
    const [latest] = await runner
      .select({ last: table.last, lastTs: table.lastTs })
      .from(table)
      .where(where)
      .orderBy(sql`${table.lastTs} desc`)
      .limit(1);
    if (latest && (bestLastTs === null || latest.lastTs > bestLastTs)) {
      bestLastTs = latest.lastTs;
      acc.last = latest.last;
      acc.lastTs = latest.lastTs;
    }
  }
  return acc;
}

/**
 * Fold several single-tier {@link SeriesWindowAggregate}s (over DISJOINT time
 * sub-windows of the SAME series set) into one. Additive fields sum; `min`/`max`
 * take the extremum of the non-null parts; `last`/`lastTs` take the latest sample
 * by `lastTs`. `seriesCount` is NOT summed (a series present in two tiers would
 * double-count) - the caller passes the exact distinct count (see
 * {@link countDistinctSeriesWithData}). Pure.
 */
export function combineWindowAggregates({
  parts,
  seriesCount,
}: {
  parts: SeriesWindowAggregate[];
  seriesCount: number;
}): SeriesWindowAggregate {
  const acc: SeriesWindowAggregate = {
    sampleCount: 0,
    sum: 0,
    min: null,
    max: null,
    last: null,
    lastTs: null,
    deltaSum: 0,
    seriesCount,
  };
  for (const part of parts) {
    acc.sampleCount += part.sampleCount;
    acc.sum += part.sum;
    acc.deltaSum += part.deltaSum;
    if (part.min !== null) {
      acc.min = acc.min === null ? part.min : Math.min(acc.min, part.min);
    }
    if (part.max !== null) {
      acc.max = acc.max === null ? part.max : Math.max(acc.max, part.max);
    }
    if (
      part.lastTs !== null &&
      (acc.lastTs === null || part.lastTs > acc.lastTs)
    ) {
      acc.last = part.last;
      acc.lastTs = part.lastTs;
    }
  }
  return acc;
}

/** A tier-scoped `[from, to)` sub-window to count distinct series over. */
export interface TierRange {
  grain: BucketGrain;
  from: Date;
  to: Date;
}

/**
 * Count the DISTINCT series (out of `seriesIds`) that have at least one bucket in
 * ANY of the given tier ranges. Used to compute a cross-tier window's
 * `seriesCount` without double-counting a series that appears in both the minute
 * and hourly tier. Chunked over the id set (chunks are disjoint, so their union
 * sizes add). Returns 0 for an empty id set / no ranges.
 */
export async function countDistinctSeriesWithData({
  runner,
  seriesIds,
  ranges,
}: {
  runner: Runner;
  seriesIds: string[];
  ranges: TierRange[];
}): Promise<number> {
  if (seriesIds.length === 0 || ranges.length === 0) return 0;
  const found = new Set<string>();
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    for (const range of ranges) {
      const table = bucketTable(range.grain);
      const rows = await runner
        .selectDistinct({ seriesId: table.seriesId })
        .from(table)
        .where(
          and(
            inArray(table.seriesId, part),
            gte(table.bucketStart, range.from),
            lt(table.bucketStart, range.to),
          ),
        );
      for (const r of rows) found.add(r.seriesId);
    }
  }
  return found.size;
}

/** One (series, bucket) cumulative point, for read-time counter rate math. */
export interface SeriesCumulativePoint {
  seriesId: string;
  bucketStart: Date;
  last: number;
  lastTs: Date;
}

/**
 * The per-(series, bucket) `last` values over `[from, to)` at one tier, ordered
 * by series then bucket. C2 differences successive cumulative `last` values with
 * reset detection (`next.last < prev.last => reset; delta = next.last`) to derive
 * counter rate/increase. Chunked over the series id set.
 */
export async function readCumulativePoints({
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
}): Promise<SeriesCumulativePoint[]> {
  if (seriesIds.length === 0) return [];
  const table = bucketTable(grain);
  const out: SeriesCumulativePoint[] = [];
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    const rows = await runner
      .select({
        seriesId: table.seriesId,
        bucketStart: table.bucketStart,
        last: table.last,
        lastTs: table.lastTs,
      })
      .from(table)
      .where(
        and(
          inArray(table.seriesId, part),
          gte(table.bucketStart, from),
          lt(table.bucketStart, to),
        ),
      )
      .orderBy(asc(table.seriesId), asc(table.bucketStart));
    for (const r of rows) {
      out.push({
        seriesId: r.seriesId,
        bucketStart: r.bucketStart,
        last: r.last,
        lastTs: r.lastTs,
      });
    }
  }
  return out;
}

/**
 * Roll a range of minute buckets up into hourly buckets, in ONE set-based upsert
 * per bounded batch (the logstream rollup lesson). Folds `count/sum/deltaSum`
 * additively, `min = least`, `max = greatest`, and `last`/`last_ts` with the
 * same latest-lastTs-wins rule as the minute upsert. Returns the number of
 * minute rows folded (so the caller can loop until a batch is empty). The caller
 * deletes the folded minute rows separately (retention) after the hourly write
 * commits.
 */
export async function rollupMinuteToHourly({
  runner,
  olderThan,
  limit,
}: {
  runner: Runner;
  /** Fold minute buckets with `bucketStart < olderThan` (typically the min-retention cutoff). */
  olderThan: Date;
  limit: number;
}): Promise<number> {
  const source = await runner
    .select({
      seriesId: metricMinuteBuckets.seriesId,
      bucketStart: metricMinuteBuckets.bucketStart,
      count: metricMinuteBuckets.count,
      sum: metricMinuteBuckets.sum,
      min: metricMinuteBuckets.min,
      max: metricMinuteBuckets.max,
      last: metricMinuteBuckets.last,
      lastTs: metricMinuteBuckets.lastTs,
      deltaSum: metricMinuteBuckets.deltaSum,
    })
    .from(metricMinuteBuckets)
    .where(lt(metricMinuteBuckets.bucketStart, olderThan))
    .orderBy(asc(metricMinuteBuckets.bucketStart))
    .limit(limit);
  if (source.length === 0) return 0;

  // Pre-aggregate minute rows that fold into the SAME hourly bucket within this
  // batch. Postgres rejects an ON CONFLICT whose one statement proposes two rows
  // with the same conflict target, so the reduction MUST happen here in JS (with
  // the same fold rules the SQL upsert applies against existing hourly rows):
  // count/sum/deltaSum add, min=least, max=greatest, last=latest-lastTs-wins.
  const byBucket = new Map<
    string,
    (typeof metricHourlyBuckets)["$inferInsert"]
  >();
  for (const r of source) {
    const hourStart = new Date(
      Math.floor(r.bucketStart.getTime() / 3_600_000) * 3_600_000,
    );
    const key = `${r.seriesId} ${hourStart.getTime()}`;
    const existing = byBucket.get(key);
    if (!existing) {
      byBucket.set(key, {
        seriesId: r.seriesId,
        bucketStart: hourStart,
        count: Number(r.count),
        sum: r.sum,
        min: r.min,
        max: r.max,
        last: r.last,
        lastTs: r.lastTs,
        deltaSum: r.deltaSum,
      });
      continue;
    }
    existing.count = Number(existing.count) + Number(r.count);
    existing.sum = Number(existing.sum) + r.sum;
    existing.min = Math.min(Number(existing.min), r.min);
    existing.max = Math.max(Number(existing.max), r.max);
    existing.deltaSum = Number(existing.deltaSum) + r.deltaSum;
    if (r.lastTs >= (existing.lastTs as Date)) {
      existing.last = r.last;
      existing.lastTs = r.lastTs;
    }
  }
  const rows = [...byBucket.values()];
  for (const part of chunk({ items: rows, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(metricHourlyBuckets)
      .values(part)
      .onConflictDoUpdate({
        target: [metricHourlyBuckets.seriesId, metricHourlyBuckets.bucketStart],
        set: {
          count: sql`${metricHourlyBuckets.count} + excluded."count"`,
          sum: sql`${metricHourlyBuckets.sum} + excluded."sum"`,
          min: sql`least(${metricHourlyBuckets.min}, excluded."min")`,
          max: sql`greatest(${metricHourlyBuckets.max}, excluded."max")`,
          deltaSum: sql`${metricHourlyBuckets.deltaSum} + excluded.delta_sum`,
          last: sql`case when excluded.last_ts >= ${metricHourlyBuckets.lastTs} then excluded."last" else ${metricHourlyBuckets.last} end`,
          lastTs: sql`greatest(${metricHourlyBuckets.lastTs}, excluded.last_ts)`,
        },
      });
  }
  return source.length;
}

/** Delete minute buckets older than `cutoff`, in a bounded batch. Returns rows deleted. */
export async function deleteExpiredMinuteBuckets({
  runner,
  cutoff,
  limit,
}: {
  runner: Runner;
  cutoff: Date;
  limit: number;
}): Promise<number> {
  const doomed = await runner
    .select({
      seriesId: metricMinuteBuckets.seriesId,
      bucketStart: metricMinuteBuckets.bucketStart,
    })
    .from(metricMinuteBuckets)
    .where(lt(metricMinuteBuckets.bucketStart, cutoff))
    .limit(limit);
  if (doomed.length === 0) return 0;
  // Delete by the exact (seriesId, bucketStart) pairs found, so the batch bound
  // holds even under concurrent writes.
  for (const part of chunk({ items: doomed, size: STORAGE_CHUNK_SIZE })) {
    await runner.delete(metricMinuteBuckets).where(
      sql`(${metricMinuteBuckets.seriesId}, ${metricMinuteBuckets.bucketStart}) in (${sql.join(
        part.map((p) => sql`(${p.seriesId}, ${p.bucketStart})`),
        sql`, `,
      )})`,
    );
  }
  return doomed.length;
}

/** Delete hourly buckets older than `cutoff`, in a bounded batch. Returns rows deleted. */
export async function deleteExpiredHourlyBuckets({
  runner,
  cutoff,
  limit,
}: {
  runner: Runner;
  cutoff: Date;
  limit: number;
}): Promise<number> {
  const doomed = await runner
    .select({
      seriesId: metricHourlyBuckets.seriesId,
      bucketStart: metricHourlyBuckets.bucketStart,
    })
    .from(metricHourlyBuckets)
    .where(lt(metricHourlyBuckets.bucketStart, cutoff))
    .limit(limit);
  if (doomed.length === 0) return 0;
  for (const part of chunk({ items: doomed, size: STORAGE_CHUNK_SIZE })) {
    await runner.delete(metricHourlyBuckets).where(
      sql`(${metricHourlyBuckets.seriesId}, ${metricHourlyBuckets.bucketStart}) in (${sql.join(
        part.map((p) => sql`(${p.seriesId}, ${p.bucketStart})`),
        sql`, `,
      )})`,
    );
  }
  return doomed.length;
}

/** Delete all buckets (both tiers) for a set of series ids - used by stream/series delete. */
export async function deleteBucketsForSeries({
  runner,
  seriesIds,
}: {
  runner: Runner;
  seriesIds: string[];
}): Promise<void> {
  if (seriesIds.length === 0) return;
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .delete(metricMinuteBuckets)
      .where(inArray(metricMinuteBuckets.seriesId, part));
    await runner
      .delete(metricHourlyBuckets)
      .where(inArray(metricHourlyBuckets.seriesId, part));
  }
}
