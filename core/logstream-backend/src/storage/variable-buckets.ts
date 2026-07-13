/**
 * Storage helpers for pattern-variable numeric aggregates - the `<*>` wildcard
 * value metrics (count/sum/min/max per minute) that back the `pattern-metric`
 * health collector. They mirror the severity/pattern bucket helpers exactly:
 * multi-row `ON CONFLICT` folds, a windowed read, and a minute->hourly rollup.
 *
 * Only PLAIN FINITE NUMBERS are folded into these buckets; the ingest fold skips
 * non-numeric wildcard values (Phase C). This module is agnostic to that - it
 * accumulates whatever numeric deltas it is handed.
 */

import type { ScopedQueryRunner, SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { and, asc, eq, gte, lt, inArray, sql } from "drizzle-orm";
import type { PatternVariableWindow } from "@checkstack/logstream-common";
import type { BucketGrain } from "@checkstack/logstream-common";
import * as schema from "../schema";
import {
  logPatternVariableBuckets,
  logPatternVariableHourly,
} from "../schema";
import { chunk, floorToHour, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;
type Db = SafeDatabase<typeof schema>;

/**
 * A pre-folded pattern-variable delta for one (stream, pattern, wildcard
 * position, minute). `count` is how many numeric samples this flush observed;
 * `sum`/`min`/`max` are this flush's numeric stats over those samples.
 */
export interface VariableBucketDelta {
  streamId: string;
  patternId: string;
  varIndex: number;
  bucketStart: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
}

function variableTable(grain: BucketGrain) {
  return grain === "hour" ? logPatternVariableHourly : logPatternVariableBuckets;
}

/**
 * Accumulate pattern-variable minute buckets:
 * `INSERT ... ON CONFLICT (streamId, patternId, varIndex, bucketStart) DO
 *  UPDATE SET count = count + excluded.count, sum = sum + excluded.sum,
 *  min = least(min, excluded.min), max = greatest(max, excluded.max)`.
 * Multi-row, chunked; run inside the flush tx.
 */
export async function upsertVariableBuckets({
  runner,
  deltas,
}: {
  runner: Runner;
  deltas: VariableBucketDelta[];
}): Promise<void> {
  if (deltas.length === 0) return;
  for (const part of chunk({ items: deltas, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(logPatternVariableBuckets)
      .values(part)
      .onConflictDoUpdate({
        target: [
          logPatternVariableBuckets.streamId,
          logPatternVariableBuckets.patternId,
          logPatternVariableBuckets.varIndex,
          logPatternVariableBuckets.bucketStart,
        ],
        set: {
          count: sql`${logPatternVariableBuckets.count} + excluded."count"`,
          sum: sql`${logPatternVariableBuckets.sum} + excluded."sum"`,
          min: sql`least(${logPatternVariableBuckets.min}, excluded."min")`,
          max: sql`greatest(${logPatternVariableBuckets.max}, excluded."max")`,
        },
      });
  }
}

/**
 * Sum one pattern variable's numeric stats over `[from, to)` at a single tier -
 * the windowed metric the `pattern-metric` collector reads. `sampleCount` sums
 * the per-bucket counts; `sum` sums the per-bucket sums; `min`/`max` are the
 * extrema across buckets (null when the window has no samples). Cross-tier
 * windows are composed by the caller summing both tiers over their sub-ranges.
 */
export async function readPatternVariableWindow({
  runner,
  streamId,
  patternId,
  varIndex,
  from,
  to,
  grain,
}: {
  runner: Runner;
  streamId: string;
  patternId: string;
  varIndex: number;
  from: Date;
  to: Date;
  grain: BucketGrain;
}): Promise<PatternVariableWindow> {
  const table = variableTable(grain);
  const [row] = await runner
    .select({
      sampleCount: sql<string>`coalesce(sum(${table.count}), 0)`,
      sum: sql<string>`coalesce(sum(${table.sum}), 0)`,
      min: sql<string | null>`min(${table.min})`,
      max: sql<string | null>`max(${table.max})`,
    })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        eq(table.patternId, patternId),
        eq(table.varIndex, varIndex),
        gte(table.bucketStart, from),
        lt(table.bucketStart, to),
      ),
    );
  return {
    sampleCount: Number(row?.sampleCount ?? 0),
    sum: Number(row?.sum ?? 0),
    min: row?.min == null ? null : Number(row.min),
    max: row?.max == null ? null : Number(row.max),
  };
}

// ============================================================================
// ROLLUP (minute -> hourly)
// ============================================================================

/** A hourly-grain variable aggregate row (rollup output). */
export interface VariableBucketRow {
  patternId: string;
  varIndex: number;
  bucketStart: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
}

/**
 * Fold minute variable rows into hourly (sum count/sum, min/max extrema, grouped
 * by hour + patternId + varIndex). Pure; mirrors `rollupPatternToHourly`.
 */
export function rollupVariableToHourly(
  rows: VariableBucketRow[],
): VariableBucketRow[] {
  const groups = new Map<string, VariableBucketRow>();
  for (const row of rows) {
    const hour = floorToHour(row.bucketStart);
    const key = `${hour.getTime()}|${row.patternId}|${row.varIndex}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += row.count;
      existing.sum += row.sum;
      existing.min = Math.min(existing.min, row.min);
      existing.max = Math.max(existing.max, row.max);
    } else {
      groups.set(key, {
        patternId: row.patternId,
        varIndex: row.varIndex,
        bucketStart: hour,
        count: row.count,
        sum: row.sum,
        min: row.min,
        max: row.max,
      });
    }
  }
  return [...groups.values()];
}

/**
 * Roll minute variable buckets older than cutoff into hourly, then delete them.
 * Batched by distinct minute bucket and atomic per batch, exactly like
 * `rollupPatternBuckets` in the retention job (a crash between the hourly UPSERT
 * and the minute delete would otherwise double-count on the BullMQ retry).
 */
export async function rollupVariableBuckets({
  db,
  streamId,
  minuteCutoff,
  batchSize = 500,
}: {
  db: Db;
  streamId: string;
  minuteCutoff: Date;
  batchSize?: number;
}): Promise<void> {
  for (;;) {
    const processed = await withScopedTransaction(db, async (tx) => {
      const buckets = await tx
        .selectDistinct({ bucketStart: logPatternVariableBuckets.bucketStart })
        .from(logPatternVariableBuckets)
        .where(
          and(
            eq(logPatternVariableBuckets.streamId, streamId),
            lt(logPatternVariableBuckets.bucketStart, minuteCutoff),
          ),
        )
        .orderBy(asc(logPatternVariableBuckets.bucketStart))
        .limit(batchSize);
      if (buckets.length === 0) return 0;
      const bucketStarts = buckets.map((b) => b.bucketStart);

      const rows = await tx
        .select({
          patternId: logPatternVariableBuckets.patternId,
          varIndex: logPatternVariableBuckets.varIndex,
          bucketStart: logPatternVariableBuckets.bucketStart,
          count: logPatternVariableBuckets.count,
          sum: logPatternVariableBuckets.sum,
          min: logPatternVariableBuckets.min,
          max: logPatternVariableBuckets.max,
        })
        .from(logPatternVariableBuckets)
        .where(
          and(
            eq(logPatternVariableBuckets.streamId, streamId),
            inArray(logPatternVariableBuckets.bucketStart, bucketStarts),
          ),
        );

      const hourly = rollupVariableToHourly(
        rows.map((r) => ({
          patternId: r.patternId,
          varIndex: r.varIndex,
          bucketStart: r.bucketStart,
          count: Number(r.count),
          sum: Number(r.sum),
          min: Number(r.min),
          max: Number(r.max),
        })),
      );
      for (const part of chunk({ items: hourly, size: STORAGE_CHUNK_SIZE })) {
        await tx
          .insert(logPatternVariableHourly)
          .values(part.map((h) => ({ streamId, ...h })))
          .onConflictDoUpdate({
            target: [
              logPatternVariableHourly.streamId,
              logPatternVariableHourly.patternId,
              logPatternVariableHourly.varIndex,
              logPatternVariableHourly.bucketStart,
            ],
            set: {
              count: sql`${logPatternVariableHourly.count} + excluded."count"`,
              sum: sql`${logPatternVariableHourly.sum} + excluded."sum"`,
              min: sql`least(${logPatternVariableHourly.min}, excluded."min")`,
              max: sql`greatest(${logPatternVariableHourly.max}, excluded."max")`,
            },
          });
      }
      await tx
        .delete(logPatternVariableBuckets)
        .where(
          and(
            eq(logPatternVariableBuckets.streamId, streamId),
            inArray(logPatternVariableBuckets.bucketStart, bucketStarts),
          ),
        );
      return buckets.length;
    });
    if (processed < batchSize) break;
  }
}

/** Delete hourly variable buckets older than the hourly cutoff. */
export async function deleteExpiredVariableHourly({
  db,
  streamId,
  hourlyCutoff,
}: {
  db: Db;
  streamId: string;
  hourlyCutoff: Date;
}): Promise<void> {
  await db
    .delete(logPatternVariableHourly)
    .where(
      and(
        eq(logPatternVariableHourly.streamId, streamId),
        lt(logPatternVariableHourly.bucketStart, hourlyCutoff),
      ),
    );
}
