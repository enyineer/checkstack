import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, eq, gte, lt, asc, sql } from "drizzle-orm";
import type {
  SeverityBand,
  SeverityBucketPoint,
  PatternBucketPoint,
  BucketGrain,
  StreamSeverityTotals,
} from "@checkstack/logstream-common";
import { SEVERITY_BANDS } from "@checkstack/logstream-common";
import * as schema from "../schema";
import {
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
} from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

export interface SeverityBucketDelta {
  streamId: string;
  bucketStart: Date;
  band: SeverityBand;
  count: number;
}

export interface PatternBucketDelta {
  streamId: string;
  bucketStart: Date;
  patternId: string;
  count: number;
}

/** An upsertable pattern row; `totalCount`/`severityMax` are folded on conflict. */
export type PatternUpsert = typeof logPatterns.$inferInsert;

/**
 * Accumulate severity minute-bucket counts:
 * `INSERT ... ON CONFLICT (streamId, bucketStart, band) DO UPDATE SET
 *  count = count + excluded.count`. Multi-row, chunked; run inside the flush tx.
 */
export async function upsertSeverityBuckets({
  runner,
  deltas,
}: {
  runner: Runner;
  deltas: SeverityBucketDelta[];
}): Promise<void> {
  if (deltas.length === 0) return;
  for (const part of chunk({ items: deltas, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(logSeverityBuckets)
      .values(part)
      .onConflictDoUpdate({
        target: [
          logSeverityBuckets.streamId,
          logSeverityBuckets.bucketStart,
          logSeverityBuckets.band,
        ],
        set: {
          count: sql`${logSeverityBuckets.count} + excluded."count"`,
        },
      });
  }
}

/** Same accumulation for pattern minute-buckets. */
export async function upsertPatternBuckets({
  runner,
  deltas,
}: {
  runner: Runner;
  deltas: PatternBucketDelta[];
}): Promise<void> {
  if (deltas.length === 0) return;
  for (const part of chunk({ items: deltas, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(logPatternBuckets)
      .values(part)
      .onConflictDoUpdate({
        target: [
          logPatternBuckets.streamId,
          logPatternBuckets.bucketStart,
          logPatternBuckets.patternId,
        ],
        set: {
          count: sql`${logPatternBuckets.count} + excluded."count"`,
        },
      });
  }
}

/**
 * Upsert Drain pattern rows. Each row's `totalCount` is treated as this flush's
 * DELTA: on conflict it is ADDED to the stored total, `lastSeenAt`/`severityMax`
 * advance monotonically, and the template/sample are refreshed. New rows insert
 * as-is.
 */
export async function upsertPatterns({
  runner,
  patterns,
}: {
  runner: Runner;
  patterns: PatternUpsert[];
}): Promise<void> {
  if (patterns.length === 0) return;
  for (const part of chunk({ items: patterns, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(logPatterns)
      .values(part)
      .onConflictDoUpdate({
        target: [logPatterns.id],
        set: {
          template: sql`excluded.template`,
          tokenCount: sql`excluded.token_count`,
          sampleBody: sql`excluded.sample_body`,
          lastSeenAt: sql`greatest(${logPatterns.lastSeenAt}, excluded.last_seen_at)`,
          totalCount: sql`${logPatterns.totalCount} + excluded.total_count`,
          severityMax: sql`greatest(${logPatterns.severityMax}, excluded.severity_max)`,
        },
      });
  }
}

function severityTable(grain: BucketGrain) {
  return grain === "hour" ? logSeverityHourly : logSeverityBuckets;
}

function patternTable(grain: BucketGrain) {
  return grain === "hour" ? logPatternHourly : logPatternBuckets;
}

/**
 * Read severity buckets for `[from, to)` at a single tier, ascending by bucket.
 * Chart consumers merge the minute and hour tiers themselves via
 * {@link BucketGrain}.
 */
export async function readSeverityBuckets({
  runner,
  streamId,
  from,
  to,
  grain,
}: {
  runner: Runner;
  streamId: string;
  from: Date;
  to: Date;
  grain: BucketGrain;
}): Promise<SeverityBucketPoint[]> {
  const table = severityTable(grain);
  const rows = await runner
    .select({
      bucketStart: table.bucketStart,
      band: table.band,
      count: table.count,
    })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        gte(table.bucketStart, from),
        lt(table.bucketStart, to),
      ),
    )
    .orderBy(asc(table.bucketStart));
  return rows.map((r) => ({
    bucketStart: r.bucketStart,
    band: r.band,
    count: Number(r.count),
  }));
}

/** Read pattern buckets for `[from, to)` at a single tier, ascending by bucket. */
export async function readPatternBuckets({
  runner,
  streamId,
  from,
  to,
  grain,
}: {
  runner: Runner;
  streamId: string;
  from: Date;
  to: Date;
  grain: BucketGrain;
}): Promise<PatternBucketPoint[]> {
  const table = patternTable(grain);
  const rows = await runner
    .select({
      bucketStart: table.bucketStart,
      patternId: table.patternId,
      count: table.count,
    })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        gte(table.bucketStart, from),
        lt(table.bucketStart, to),
      ),
    )
    .orderBy(asc(table.bucketStart));
  return rows.map((r) => ({
    bucketStart: r.bucketStart,
    patternId: r.patternId,
    count: Number(r.count),
  }));
}

const ZERO_TOTALS: StreamSeverityTotals = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};

/**
 * Sum per-band counts over `[from, to)` at a single tier - the windowed metric
 * the health collector and the overview page read. Returns all six bands,
 * zero-filled. (Cross-tier windows are composed by the caller summing both
 * tiers over their respective sub-ranges.)
 */
export async function sumSeverityBands({
  runner,
  streamId,
  from,
  to,
  grain,
}: {
  runner: Runner;
  streamId: string;
  from: Date;
  to: Date;
  grain: BucketGrain;
}): Promise<StreamSeverityTotals> {
  const table = severityTable(grain);
  const rows = await runner
    .select({
      band: table.band,
      total: sql<string>`sum(${table.count})`,
    })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        gte(table.bucketStart, from),
        lt(table.bucketStart, to),
      ),
    )
    .groupBy(table.band);
  const totals: StreamSeverityTotals = { ...ZERO_TOTALS };
  for (const row of rows) {
    if (SEVERITY_BANDS.includes(row.band)) {
      totals[row.band] = Number(row.total ?? 0);
    }
  }
  return totals;
}
