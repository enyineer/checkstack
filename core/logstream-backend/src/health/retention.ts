/**
 * Retention + rollup for a log stream, following the healthcheck retention
 * precedent (`core/healthcheck-backend/src/retention-job.ts`): forward-only,
 * batched deletes, and a minute->hourly rollup that folds counts before the
 * minute rows are dropped.
 *
 * The pure helpers (cutoffs, in-memory rollup grouping) are unit-tested; the DB
 * operations are exercised by the gated integration test.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { and, asc, eq, gt, lt, ne, inArray, sql } from "drizzle-orm";
import type { LogStreamConfig, SeverityBand } from "@checkstack/logstream-common";
import * as schema from "../schema";
import {
  logEvents,
  logImportantEvents,
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
} from "../schema";
import {
  floorToHour,
  chunk,
  STORAGE_CHUNK_SIZE,
  rollupVariableBuckets,
  deleteExpiredVariableHourly,
} from "../storage";

type Db = SafeDatabase<typeof schema>;

/** How many raw `log_events` rows to delete per batched statement. */
export const RAW_DELETE_BATCH = 5000;

/**
 * How many distinct minute buckets to roll up per transaction, and how many
 * stale patterns to sweep per batch. Bounds each SELECT's working set so a
 * long-neglected stream cannot load an unbounded number of rows at once.
 */
export const ROLLUP_BUCKET_BATCH = 500;
export const STALE_PATTERN_BATCH = 1000;

/** Time cutoffs (exclusive upper bounds) derived from a stream's policy. */
export interface RetentionCutoffs {
  /** Raw `log_events` older than this are deleted. */
  rawCutoff: Date;
  /** Minute buckets older than this are rolled up to hourly, then deleted. */
  minuteCutoff: Date;
  /** Hourly buckets / patterns / important events older than this are deleted. */
  hourlyCutoff: Date;
}

/** Compute the three retention cutoffs from a stream's config. Pure. */
export function computeRetentionCutoffs({
  config,
  now,
}: {
  config: LogStreamConfig;
  now: Date;
}): RetentionCutoffs {
  const ms = now.getTime();
  return {
    rawCutoff: new Date(ms - config.rawRetentionDays * 86_400_000),
    minuteCutoff: new Date(ms - config.minuteRetentionHours * 3_600_000),
    hourlyCutoff: new Date(ms - config.hourlyRetentionDays * 86_400_000),
  };
}

// ============================================================================
// PURE ROLLUP GROUPING (minute -> hour)
// ============================================================================

export interface SeverityBucketRow {
  bucketStart: Date;
  band: SeverityBand;
  count: number;
}

export interface PatternBucketRow {
  bucketStart: Date;
  patternId: string;
  count: number;
}

/** Fold minute severity rows into hourly (sum by hour+band). Pure. */
export function rollupSeverityToHourly(
  rows: SeverityBucketRow[],
): SeverityBucketRow[] {
  const groups = new Map<string, SeverityBucketRow>();
  for (const row of rows) {
    const hour = floorToHour(row.bucketStart);
    const key = `${hour.getTime()}|${row.band}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += row.count;
    } else {
      groups.set(key, { bucketStart: hour, band: row.band, count: row.count });
    }
  }
  return [...groups.values()];
}

/** Fold minute pattern rows into hourly (sum by hour+patternId). Pure. */
export function rollupPatternToHourly(
  rows: PatternBucketRow[],
): PatternBucketRow[] {
  const groups = new Map<string, PatternBucketRow>();
  for (const row of rows) {
    const hour = floorToHour(row.bucketStart);
    const key = `${hour.getTime()}|${row.patternId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += row.count;
    } else {
      groups.set(key, {
        bucketStart: hour,
        patternId: row.patternId,
        count: row.count,
      });
    }
  }
  return [...groups.values()];
}

// ============================================================================
// DB OPERATIONS (per stream)
// ============================================================================

/** Delete raw events older than the cutoff, in bounded batches. */
export async function deleteExpiredEvents({
  db,
  streamId,
  cutoff,
  batchSize = RAW_DELETE_BATCH,
}: {
  db: Db;
  streamId: string;
  cutoff: Date;
  batchSize?: number;
}): Promise<number> {
  let deleted = 0;
  for (;;) {
    const rows = await db
      .select({ id: logEvents.id })
      .from(logEvents)
      .where(and(eq(logEvents.streamId, streamId), lt(logEvents.ts, cutoff)))
      .limit(batchSize);
    if (rows.length === 0) break;
    await db.delete(logEvents).where(
      inArray(
        logEvents.id,
        rows.map((r) => r.id),
      ),
    );
    deleted += rows.length;
    if (rows.length < batchSize) break;
  }
  return deleted;
}

/**
 * Roll minute severity buckets older than cutoff into hourly, then delete them.
 *
 * Batched by distinct minute bucket (`ROLLUP_BUCKET_BATCH` at a time) so the
 * working set is bounded on a long-neglected stream. Each batch's hourly UPSERT
 * and the delete of the SAME minute rows run in ONE transaction: a crash between
 * insert and delete would otherwise leave the minute rows in place and re-roll
 * them on the BullMQ retry, double-counting the hourly bucket. Committed batches
 * have already dropped their minute rows, so a retry never re-processes them
 * (idempotent).
 */
export async function rollupSeverityBuckets({
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
      const buckets = await tx
        .selectDistinct({ bucketStart: logSeverityBuckets.bucketStart })
        .from(logSeverityBuckets)
        .where(
          and(
            eq(logSeverityBuckets.streamId, streamId),
            lt(logSeverityBuckets.bucketStart, minuteCutoff),
          ),
        )
        .orderBy(asc(logSeverityBuckets.bucketStart))
        .limit(batchSize);
      if (buckets.length === 0) return 0;
      const bucketStarts = buckets.map((b) => b.bucketStart);

      const rows = await tx
        .select({
          bucketStart: logSeverityBuckets.bucketStart,
          band: logSeverityBuckets.band,
          count: logSeverityBuckets.count,
        })
        .from(logSeverityBuckets)
        .where(
          and(
            eq(logSeverityBuckets.streamId, streamId),
            inArray(logSeverityBuckets.bucketStart, bucketStarts),
          ),
        );

      const hourly = rollupSeverityToHourly(
        rows.map((r) => ({
          bucketStart: r.bucketStart,
          band: r.band,
          count: Number(r.count),
        })),
      );
      for (const part of chunk({ items: hourly, size: STORAGE_CHUNK_SIZE })) {
        await tx
          .insert(logSeverityHourly)
          .values(part.map((h) => ({ streamId, ...h })))
          .onConflictDoUpdate({
            target: [
              logSeverityHourly.streamId,
              logSeverityHourly.bucketStart,
              logSeverityHourly.band,
            ],
            set: {
              count: sql`${logSeverityHourly.count} + excluded."count"`,
            },
          });
      }
      await tx
        .delete(logSeverityBuckets)
        .where(
          and(
            eq(logSeverityBuckets.streamId, streamId),
            inArray(logSeverityBuckets.bucketStart, bucketStarts),
          ),
        );
      return buckets.length;
    });
    if (processed < batchSize) break;
  }
}

/**
 * Roll minute pattern buckets older than cutoff into hourly, then delete them.
 * Batched + atomic per batch, exactly like {@link rollupSeverityBuckets}.
 */
export async function rollupPatternBuckets({
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
      const buckets = await tx
        .selectDistinct({ bucketStart: logPatternBuckets.bucketStart })
        .from(logPatternBuckets)
        .where(
          and(
            eq(logPatternBuckets.streamId, streamId),
            lt(logPatternBuckets.bucketStart, minuteCutoff),
          ),
        )
        .orderBy(asc(logPatternBuckets.bucketStart))
        .limit(batchSize);
      if (buckets.length === 0) return 0;
      const bucketStarts = buckets.map((b) => b.bucketStart);

      const rows = await tx
        .select({
          bucketStart: logPatternBuckets.bucketStart,
          patternId: logPatternBuckets.patternId,
          count: logPatternBuckets.count,
        })
        .from(logPatternBuckets)
        .where(
          and(
            eq(logPatternBuckets.streamId, streamId),
            inArray(logPatternBuckets.bucketStart, bucketStarts),
          ),
        );

      const hourly = rollupPatternToHourly(
        rows.map((r) => ({
          bucketStart: r.bucketStart,
          patternId: r.patternId,
          count: Number(r.count),
        })),
      );
      for (const part of chunk({ items: hourly, size: STORAGE_CHUNK_SIZE })) {
        await tx
          .insert(logPatternHourly)
          .values(part.map((h) => ({ streamId, ...h })))
          .onConflictDoUpdate({
            target: [
              logPatternHourly.streamId,
              logPatternHourly.bucketStart,
              logPatternHourly.patternId,
            ],
            set: {
              count: sql`${logPatternHourly.count} + excluded."count"`,
            },
          });
      }
      await tx
        .delete(logPatternBuckets)
        .where(
          and(
            eq(logPatternBuckets.streamId, streamId),
            inArray(logPatternBuckets.bucketStart, bucketStarts),
          ),
        );
      return buckets.length;
    });
    if (processed < batchSize) break;
  }
}

/** Delete hourly severity + pattern buckets older than the hourly cutoff. */
export async function deleteExpiredHourly({
  db,
  streamId,
  hourlyCutoff,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
}): Promise<void> {
  await db
    .delete(logSeverityHourly)
    .where(
      and(
        eq(logSeverityHourly.streamId, streamId),
        lt(logSeverityHourly.bucketStart, hourlyCutoff),
      ),
    );
  await db
    .delete(logPatternHourly)
    .where(
      and(
        eq(logPatternHourly.streamId, streamId),
        lt(logPatternHourly.bucketStart, hourlyCutoff),
      ),
    );
}

/** Delete important events older than the hourly cutoff. */
export async function deleteExpiredImportantEvents({
  db,
  streamId,
  hourlyCutoff,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
}): Promise<void> {
  await db
    .delete(logImportantEvents)
    .where(
      and(
        eq(logImportantEvents.streamId, streamId),
        lt(logImportantEvents.ts, hourlyCutoff),
      ),
    );
}

/**
 * Delete patterns not seen since the hourly cutoff that also have no remaining
 * bucket rows (minute or hourly) - so a pattern is only forgotten once all its
 * aggregates have aged out too.
 *
 * PROTECTED patterns are NEVER deleted, however quiet they go:
 * - `origin: 'user'` patterns are protected UNCONDITIONALLY (excluded in SQL).
 * - `protectedPatternIds` (patterns REFERENCED by a health check) are excluded
 *   in memory. Deleting a referenced pattern would orphan the check's picker
 *   label and let Drain re-mine it under a fresh id; the caller resolves the
 *   referenced set and passes it here.
 */
export async function deleteStalePatterns({
  db,
  streamId,
  hourlyCutoff,
  protectedPatternIds = [],
  batchSize = STALE_PATTERN_BATCH,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
  protectedPatternIds?: readonly string[];
  batchSize?: number;
}): Promise<number> {
  const protectedSet = new Set(protectedPatternIds);
  let removed = 0;
  // Keyset cursor on the pattern id: a stale pattern that STILL has bucket rows
  // (or is protected) is kept, so a plain `lastSeenAt < cutoff` re-select would
  // return it forever. Advancing past the whole batch by id guarantees
  // termination while bounding each select's working set. The cursor advances
  // over kept rows too, so protected/bucketed patterns cannot loop.
  let cursor: string | null = null;
  for (;;) {
    const conditions = [
      eq(logPatterns.streamId, streamId),
      lt(logPatterns.lastSeenAt, hourlyCutoff),
      // User patterns are protected by construction - never a stale-delete
      // candidate. Referenced (mined) patterns are filtered in memory below.
      ne(logPatterns.origin, "user"),
    ];
    if (cursor !== null) conditions.push(gt(logPatterns.id, cursor));
    const batch = await db
      .select({ id: logPatterns.id })
      .from(logPatterns)
      .where(and(...conditions))
      .orderBy(asc(logPatterns.id))
      .limit(batchSize);
    if (batch.length === 0) break;
    const ids = batch.map((p) => p.id);

    // Which of THIS batch still have aggregate rows (minute or hourly)?
    const withBuckets = new Set<string>();
    for (const table of [logPatternBuckets, logPatternHourly]) {
      const rows = await db
        .selectDistinct({ patternId: table.patternId })
        .from(table)
        .where(
          and(eq(table.streamId, streamId), inArray(table.patternId, ids)),
        );
      for (const row of rows) withBuckets.add(row.patternId);
    }

    const removable = ids.filter(
      (id) => !withBuckets.has(id) && !protectedSet.has(id),
    );
    for (const part of chunk({ items: removable, size: STORAGE_CHUNK_SIZE })) {
      await db.delete(logPatterns).where(inArray(logPatterns.id, part));
    }
    removed += removable.length;

    cursor = ids.at(-1) ?? null;
    if (batch.length < batchSize) break;
  }
  return removed;
}

/** Run the full retention + rollup pass for one stream. */
export async function runStreamRetention({
  db,
  streamId,
  config,
  now,
  protectedPatternIds = [],
}: {
  db: Db;
  streamId: string;
  config: LogStreamConfig;
  now: Date;
  /** Pattern ids referenced by a health check; excluded from stale deletion. */
  protectedPatternIds?: readonly string[];
}): Promise<void> {
  const cutoffs = computeRetentionCutoffs({ config, now });
  await deleteExpiredEvents({ db, streamId, cutoff: cutoffs.rawCutoff });
  await rollupSeverityBuckets({
    db,
    streamId,
    minuteCutoff: cutoffs.minuteCutoff,
  });
  await rollupPatternBuckets({
    db,
    streamId,
    minuteCutoff: cutoffs.minuteCutoff,
  });
  // Pattern-variable buckets share the pattern-bucket cutoffs (same minute ->
  // hourly rollup and hourly retention).
  await rollupVariableBuckets({
    db,
    streamId,
    minuteCutoff: cutoffs.minuteCutoff,
  });
  await deleteExpiredHourly({ db, streamId, hourlyCutoff: cutoffs.hourlyCutoff });
  await deleteExpiredVariableHourly({
    db,
    streamId,
    hourlyCutoff: cutoffs.hourlyCutoff,
  });
  await deleteExpiredImportantEvents({
    db,
    streamId,
    hourlyCutoff: cutoffs.hourlyCutoff,
  });
  await deleteStalePatterns({
    db,
    streamId,
    hourlyCutoff: cutoffs.hourlyCutoff,
    protectedPatternIds,
  });
}
