import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { CounterKind } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricSeries, type StoredExemplar } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

/** A new series row to admit (already cardinality-partitioned by the caller). */
export interface NewSeriesRow {
  id: string;
  streamId: string;
  name: string;
  labels: Record<string, string>;
  counterKind: CounterKind | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Newest exemplars seen for this series in the admitting flush, if any. */
  lastExemplars?: StoredExemplar[];
}

/** Count the distinct series currently registered for a stream. */
export async function countStreamSeries({
  runner,
  streamId,
}: {
  runner: Runner;
  streamId: string;
}): Promise<number> {
  const [row] = await runner
    .select({ count: sql<string>`count(*)` })
    .from(metricSeries)
    .where(eq(metricSeries.streamId, streamId));
  return Number(row?.count ?? 0);
}

/**
 * Return which of `seriesIds` already exist (so the flush can advance their
 * `lastSeenAt` and treat the rest as NEW, subject to the cardinality cap).
 * Chunked to bound the `IN (...)` list.
 */
export async function selectExistingSeriesIds({
  runner,
  seriesIds,
}: {
  runner: Runner;
  seriesIds: string[];
}): Promise<Set<string>> {
  const found = new Set<string>();
  if (seriesIds.length === 0) return found;
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    const rows = await runner
      .select({ id: metricSeries.id })
      .from(metricSeries)
      .where(inArray(metricSeries.id, part));
    for (const row of rows) found.add(row.id);
  }
  return found;
}

/**
 * Insert admitted NEW series rows. Idempotent: a concurrent pod inserting the
 * same series id first is harmless (`DO NOTHING`), and the row's `lastSeenAt` is
 * advanced separately by {@link touchSeriesLastSeen}. Multi-row, chunked.
 *
 * Returns the ids ACTUALLY inserted (the `RETURNING` of a `DO NOTHING` upsert
 * yields only genuinely-new rows, NOT the ones that lost a cross-pod conflict).
 * The flush uses this to advance the metric-name `seriesCount` by the true number
 * of new series, so a duplicate insert from another pod never over-counts a name
 * (which would permanently block that name's retention cleanup).
 */
export async function insertNewSeries({
  runner,
  rows,
}: {
  runner: Runner;
  rows: NewSeriesRow[];
}): Promise<string[]> {
  if (rows.length === 0) return [];
  const insertedIds: string[] = [];
  for (const part of chunk({ items: rows, size: STORAGE_CHUNK_SIZE })) {
    const returned = await runner
      .insert(metricSeries)
      .values(part)
      .onConflictDoNothing({ target: [metricSeries.id] })
      .returning({ id: metricSeries.id });
    for (const r of returned) insertedIds.push(r.id);
  }
  return insertedIds;
}

/** Advance `lastSeenAt` for a set of already-existing series. Chunked. */
export async function touchSeriesLastSeen({
  runner,
  seriesIds,
  lastSeenAt,
}: {
  runner: Runner;
  seriesIds: string[];
  lastSeenAt: Date;
}): Promise<void> {
  if (seriesIds.length === 0) return;
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .update(metricSeries)
      .set({ lastSeenAt: sql`greatest(${metricSeries.lastSeenAt}, ${lastSeenAt})` })
      .where(inArray(metricSeries.id, part));
  }
}

/**
 * Delete series whose `lastSeenAt` is older than `cutoff` for a stream, in a
 * bounded batch (retention). Returns the deleted ids so the caller can decrement
 * the owning metric-name `seriesCount` and drop any orphaned buckets. Callers
 * must additionally guard referenced metric names (health-check protection) and
 * loop until fewer than `limit` rows come back.
 */
export async function deleteExpiredSeriesBatch({
  runner,
  streamId,
  cutoff,
  limit,
}: {
  runner: Runner;
  streamId: string;
  cutoff: Date;
  limit: number;
}): Promise<string[]> {
  const doomed = await runner
    .select({ id: metricSeries.id })
    .from(metricSeries)
    .where(
      and(eq(metricSeries.streamId, streamId), lt(metricSeries.lastSeenAt, cutoff)),
    )
    .limit(limit);
  const ids = doomed.map((r) => r.id);
  if (ids.length === 0) return [];
  await runner.delete(metricSeries).where(inArray(metricSeries.id, ids));
  return ids;
}
