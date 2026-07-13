/**
 * Retention + rollup for metric streams, following the logstream precedent:
 * forward-only, batched deletes, and a minute->hourly rollup that folds counts
 * atomically before the minute rows are dropped.
 *
 * Buckets key on `seriesId`, but every retention cutoff is per-STREAM (each
 * stream configures its own minute/hourly retention), so the bucket sweeps join
 * to `metric_series` to scope by the owning stream. The pure helper (cutoffs) is
 * unit-tested; the DB operations are exercised by the gated integration test.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { MetricStreamConfig } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import {
  metricSeries,
  metricNames,
  metricMinuteBuckets,
  metricHourlyBuckets,
  metricImportantEvents,
} from "../schema";
import {
  chunk,
  STORAGE_CHUNK_SIZE,
  floorToHour,
  decrementSeriesCount,
} from "../storage";

type Db = SafeDatabase<typeof schema>;

/** How many minute buckets to roll up per atomic transaction. */
export const ROLLUP_BUCKET_BATCH = 1000;
/** How many candidate series to sweep per batch. */
export const SERIES_SWEEP_BATCH = 1000;
/** How many name rows to sweep per batch. */
export const NAME_SWEEP_BATCH = 1000;
/** How many hourly-bucket / event rows to delete per batch. */
export const DELETE_BATCH = 5000;

/** Time cutoffs (exclusive upper bounds) derived from a stream's policy. */
export interface RetentionCutoffs {
  /** Minute buckets older than this are rolled up to hourly, then deleted. */
  minuteCutoff: Date;
  /** Hourly buckets / important events older than this are deleted; series
   * whose `lastSeenAt` predates it are candidates for removal. */
  hourlyCutoff: Date;
}

/** Compute the retention cutoffs from a stream's config. Pure. */
export function computeRetentionCutoffs({
  config,
  now,
}: {
  config: MetricStreamConfig;
  now: Date;
}): RetentionCutoffs {
  const ms = now.getTime();
  return {
    minuteCutoff: new Date(ms - config.minuteRetentionHours * 3_600_000),
    hourlyCutoff: new Date(ms - config.hourlyRetentionDays * 86_400_000),
  };
}

// ============================================================================
// MINUTE -> HOURLY ROLLUP (per stream; atomic per batch)
// ============================================================================

interface HourlyFold {
  seriesId: string;
  bucketStart: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
  lastTs: Date;
  deltaSum: number;
}

/**
 * Roll a stream's minute buckets older than `minuteCutoff` up into hourly
 * buckets, then delete the folded minute rows - each batch's hourly UPSERT and
 * the delete of the SAME minute rows run in ONE transaction, so a crash between
 * insert and delete never double-counts on the BullMQ retry (committed batches
 * have already dropped their minute rows). Batched by exact
 * (seriesId, bucketStart) key so the working set is bounded and the delete
 * removes EXACTLY the rows folded. Scoped to the stream by joining
 * `metric_series` (buckets carry no stream id).
 */
export async function rollupStreamMinuteBuckets({
  db,
  streamId,
  minuteCutoff,
  batchSize = ROLLUP_BUCKET_BATCH,
}: {
  db: Db;
  streamId: string;
  minuteCutoff: Date;
  batchSize?: number;
}): Promise<void> {
  for (;;) {
    const processed = await withScopedTransaction(db, async (tx) => {
      const rows = await tx
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
        .innerJoin(
          metricSeries,
          eq(metricSeries.id, metricMinuteBuckets.seriesId),
        )
        .where(
          and(
            eq(metricSeries.streamId, streamId),
            lt(metricMinuteBuckets.bucketStart, minuteCutoff),
          ),
        )
        .orderBy(asc(metricMinuteBuckets.bucketStart))
        .limit(batchSize);
      if (rows.length === 0) return 0;

      // Pre-aggregate minute rows that fold into the SAME hourly bucket within
      // this batch (Postgres rejects an ON CONFLICT proposing two rows with the
      // same conflict target). Same fold rules as the SQL upsert against
      // existing hourly rows: count/sum/deltaSum add, min=least, max=greatest,
      // last=latest-lastTs-wins.
      const byBucket = new Map<string, HourlyFold>();
      for (const r of rows) {
        const hourStart = floorToHour(r.bucketStart);
        const key = `${r.seriesId} ${hourStart.getTime()}`;
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
        existing.count += Number(r.count);
        existing.sum += r.sum;
        existing.min = Math.min(existing.min, r.min);
        existing.max = Math.max(existing.max, r.max);
        existing.deltaSum += r.deltaSum;
        if (r.lastTs >= existing.lastTs) {
          existing.last = r.last;
          existing.lastTs = r.lastTs;
        }
      }

      for (const part of chunk({
        items: [...byBucket.values()],
        size: STORAGE_CHUNK_SIZE,
      })) {
        await tx
          .insert(metricHourlyBuckets)
          .values(part)
          .onConflictDoUpdate({
            target: [
              metricHourlyBuckets.seriesId,
              metricHourlyBuckets.bucketStart,
            ],
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

      // Delete EXACTLY the folded minute rows by their (seriesId, bucketStart)
      // pairs, so the batch bound holds even under concurrent writes.
      for (const part of chunk({ items: rows, size: STORAGE_CHUNK_SIZE })) {
        await tx.delete(metricMinuteBuckets).where(
          sql`(${metricMinuteBuckets.seriesId}, ${metricMinuteBuckets.bucketStart}) in (${sql.join(
            part.map((p) => sql`(${p.seriesId}, ${p.bucketStart})`),
            sql`, `,
          )})`,
        );
      }
      return rows.length;
    });
    if (processed < batchSize) break;
  }
}

/**
 * Delete a stream's hourly buckets older than the cutoff, in bounded batches.
 * Scoped to the stream via a `metric_series` join; deletes the exact
 * (seriesId, bucketStart) pairs found.
 */
export async function deleteExpiredStreamHourly({
  db,
  streamId,
  hourlyCutoff,
  batchSize = DELETE_BATCH,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
  batchSize?: number;
}): Promise<void> {
  for (;;) {
    const doomed = await db
      .select({
        seriesId: metricHourlyBuckets.seriesId,
        bucketStart: metricHourlyBuckets.bucketStart,
      })
      .from(metricHourlyBuckets)
      .innerJoin(
        metricSeries,
        eq(metricSeries.id, metricHourlyBuckets.seriesId),
      )
      .where(
        and(
          eq(metricSeries.streamId, streamId),
          lt(metricHourlyBuckets.bucketStart, hourlyCutoff),
        ),
      )
      .limit(batchSize);
    if (doomed.length === 0) break;
    for (const part of chunk({ items: doomed, size: STORAGE_CHUNK_SIZE })) {
      await db.delete(metricHourlyBuckets).where(
        sql`(${metricHourlyBuckets.seriesId}, ${metricHourlyBuckets.bucketStart}) in (${sql.join(
          part.map((p) => sql`(${p.seriesId}, ${p.bucketStart})`),
          sql`, `,
        )})`,
      );
    }
    if (doomed.length < batchSize) break;
  }
}

/** Delete a stream's important events older than the cutoff, in bounded batches. */
export async function deleteExpiredImportantEvents({
  db,
  streamId,
  hourlyCutoff,
  batchSize = DELETE_BATCH,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
  batchSize?: number;
}): Promise<void> {
  for (;;) {
    const doomed = await db
      .select({ id: metricImportantEvents.id })
      .from(metricImportantEvents)
      .where(
        and(
          eq(metricImportantEvents.streamId, streamId),
          lt(metricImportantEvents.ts, hourlyCutoff),
        ),
      )
      .limit(batchSize);
    if (doomed.length === 0) break;
    await db.delete(metricImportantEvents).where(
      inArray(
        metricImportantEvents.id,
        doomed.map((r) => r.id),
      ),
    );
    if (doomed.length < batchSize) break;
  }
}

// ============================================================================
// SERIES + NAME REGISTRY SWEEP (reference-aware)
// ============================================================================

/**
 * Delete a stream's series whose `lastSeenAt` is older than `cutoff`, that have
 * NO remaining bucket rows (minute or hourly), and whose metric NAME is NOT
 * referenced by a health check. Each removed series decrements its metric
 * name's `seriesCount`. Keyset-cursored by series id so each batch's working set
 * is bounded and protected/bucketed series cannot loop.
 *
 * Referenced-name protection keeps a quiet-but-watched name's registry rows (and
 * the series that anchor its label autocomplete + staleness fallback) alive
 * while a check still points at it; the buckets have already aged out normally.
 */
export async function expireSeries({
  db,
  streamId,
  cutoff,
  referencedNames,
  batchSize = SERIES_SWEEP_BATCH,
}: {
  db: Db;
  streamId: string;
  cutoff: Date;
  referencedNames: Set<string>;
  batchSize?: number;
}): Promise<number> {
  let removed = 0;
  let cursor: string | null = null;
  for (;;) {
    const conditions = [
      eq(metricSeries.streamId, streamId),
      lt(metricSeries.lastSeenAt, cutoff),
    ];
    if (cursor !== null) conditions.push(gt(metricSeries.id, cursor));
    const batch = await db
      .select({ id: metricSeries.id, name: metricSeries.name })
      .from(metricSeries)
      .where(and(...conditions))
      .orderBy(asc(metricSeries.id))
      .limit(batchSize);
    if (batch.length === 0) break;

    // Referenced names are spared unconditionally.
    const candidates = batch.filter((s) => !referencedNames.has(s.name));
    const candidateIds = candidates.map((s) => s.id);

    // Which candidates still have aggregate rows (minute or hourly)? Those are
    // kept until their buckets age out too.
    const withBuckets = new Set<string>();
    if (candidateIds.length > 0) {
      for (const table of [metricMinuteBuckets, metricHourlyBuckets]) {
        for (const part of chunk({
          items: candidateIds,
          size: STORAGE_CHUNK_SIZE,
        })) {
          const rows = await db
            .selectDistinct({ seriesId: table.seriesId })
            .from(table)
            .where(inArray(table.seriesId, part));
          for (const row of rows) withBuckets.add(row.seriesId);
        }
      }
    }

    const removable = candidates.filter((s) => !withBuckets.has(s.id));
    const byName = new Map<string, number>();
    for (const s of removable) byName.set(s.name, (byName.get(s.name) ?? 0) + 1);

    for (const part of chunk({
      items: removable.map((s) => s.id),
      size: STORAGE_CHUNK_SIZE,
    })) {
      await db.delete(metricSeries).where(inArray(metricSeries.id, part));
    }
    for (const [name, delta] of byName) {
      await decrementSeriesCount({ runner: db, streamId, name, delta });
    }
    removed += removable.length;

    cursor = batch.at(-1)?.id ?? null;
    if (batch.length < batchSize) break;
  }
  return removed;
}

/**
 * Delete a stream's metric-name registry rows whose `seriesCount` has reached 0
 * and whose name is NOT referenced by a health check. Bounded batches.
 */
export async function cleanupNames({
  db,
  streamId,
  referencedNames,
  batchSize = NAME_SWEEP_BATCH,
}: {
  db: Db;
  streamId: string;
  referencedNames: Set<string>;
  batchSize?: number;
}): Promise<number> {
  let removed = 0;
  let cursor: string | null = null;
  for (;;) {
    const conditions = [
      eq(metricNames.streamId, streamId),
      lt(metricNames.seriesCount, 1),
    ];
    if (cursor !== null) conditions.push(gt(metricNames.name, cursor));
    const batch = await db
      .select({ name: metricNames.name })
      .from(metricNames)
      .where(and(...conditions))
      .orderBy(asc(metricNames.name))
      .limit(batchSize);
    if (batch.length === 0) break;

    const removable = batch
      .map((r) => r.name)
      .filter((name) => !referencedNames.has(name));
    for (const part of chunk({ items: removable, size: STORAGE_CHUNK_SIZE })) {
      await db
        .delete(metricNames)
        .where(
          and(eq(metricNames.streamId, streamId), inArray(metricNames.name, part)),
        );
    }
    removed += removable.length;

    cursor = batch.at(-1)?.name ?? null;
    if (batch.length < batchSize) break;
  }
  return removed;
}

/** Run the full retention pass for one stream (rollup runs on its own cadence). */
export async function runStreamRetention({
  db,
  streamId,
  config,
  now,
  referencedNames,
}: {
  db: Db;
  streamId: string;
  config: MetricStreamConfig;
  now: Date;
  referencedNames: Set<string>;
}): Promise<void> {
  const cutoffs = computeRetentionCutoffs({ config, now });
  await deleteExpiredStreamHourly({
    db,
    streamId,
    hourlyCutoff: cutoffs.hourlyCutoff,
  });
  await deleteExpiredImportantEvents({
    db,
    streamId,
    hourlyCutoff: cutoffs.hourlyCutoff,
  });
  await expireSeries({
    db,
    streamId,
    cutoff: cutoffs.hourlyCutoff,
    referencedNames,
  });
  await cleanupNames({ db, streamId, referencedNames });
}
