import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, eq, ilike, sql } from "drizzle-orm";
import type {
  CounterKind,
  MetricNameInfo,
  MetricType,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricNames } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

/**
 * A metric-name upsert. `seriesCountDelta` is how many NEW series for this name
 * were admitted in the flush (0 when only existing series updated); it is ADDED
 * to the stored `seriesCount` on conflict. `type`/`counterKind`/`unit`/`help`
 * refresh to the latest observed values; `lastSeenAt` advances monotonically.
 */
export interface MetricNameUpsert {
  streamId: string;
  name: string;
  type: MetricType;
  counterKind: CounterKind | null;
  unit: string | null;
  help: string | null;
  seriesCountDelta: number;
  lastSeenAt: Date;
}

/**
 * Upsert metric-name registry rows, folding `seriesCountDelta` into the stored
 * `seriesCount`. Multi-row, chunked; run inside the flush transaction so the
 * count stays consistent with the series admitted in the same commit.
 */
export async function upsertMetricNames({
  runner,
  upserts,
}: {
  runner: Runner;
  upserts: MetricNameUpsert[];
}): Promise<void> {
  if (upserts.length === 0) return;
  const rows = upserts.map((u) => ({
    streamId: u.streamId,
    name: u.name,
    type: u.type,
    counterKind: u.counterKind,
    unit: u.unit,
    help: u.help,
    seriesCount: u.seriesCountDelta,
    lastSeenAt: u.lastSeenAt,
  }));
  for (const part of chunk({ items: rows, size: STORAGE_CHUNK_SIZE })) {
    await runner
      .insert(metricNames)
      .values(part)
      .onConflictDoUpdate({
        target: [metricNames.streamId, metricNames.name],
        set: {
          type: sql`excluded.type`,
          counterKind: sql`excluded.counter_kind`,
          unit: sql`excluded.unit`,
          help: sql`excluded.help`,
          seriesCount: sql`${metricNames.seriesCount} + excluded.series_count`,
          lastSeenAt: sql`greatest(${metricNames.lastSeenAt}, excluded.last_seen_at)`,
        },
      });
  }
}

/**
 * Decrement a metric name's `seriesCount` by `delta` (retention removing series).
 * Clamped at 0 so a race can never drive it negative.
 */
export async function decrementSeriesCount({
  runner,
  streamId,
  name,
  delta,
}: {
  runner: Runner;
  streamId: string;
  name: string;
  delta: number;
}): Promise<void> {
  if (delta <= 0) return;
  await runner
    .update(metricNames)
    .set({
      seriesCount: sql`greatest(0, ${metricNames.seriesCount} - ${delta})`,
    })
    .where(
      and(eq(metricNames.streamId, streamId), eq(metricNames.name, name)),
    );
}

/**
 * List a stream's metric names, optionally substring-filtered, ordered by name.
 * Reads ONLY the metric-name registry (never scans series), so autocomplete is
 * cheap.
 */
export async function listMetricNames({
  runner,
  streamId,
  query,
  limit,
}: {
  runner: Runner;
  streamId: string;
  query?: string;
  limit: number;
}): Promise<MetricNameInfo[]> {
  const where = query
    ? and(eq(metricNames.streamId, streamId), ilike(metricNames.name, `%${query}%`))
    : eq(metricNames.streamId, streamId);
  const rows = await runner
    .select()
    .from(metricNames)
    .where(where)
    .orderBy(metricNames.name)
    .limit(limit);
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    counterKind: r.counterKind,
    unit: r.unit,
    help: r.help,
    seriesCount: Number(r.seriesCount),
    lastSeenAt: r.lastSeenAt,
  }));
}
