import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import {
  MAX_EXEMPLARS_PER_POINT,
  type MetricExemplar,
} from "@checkstack/telemetry-common";
import * as schema from "../schema";
import { metricSeries, type StoredExemplar } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

/** Serialize a normalized exemplar into the jsonb-stored shape (ts -> epoch ms). */
export function toStoredExemplar(exemplar: MetricExemplar): StoredExemplar {
  return {
    traceId: exemplar.traceId,
    ...(exemplar.spanId ? { spanId: exemplar.spanId } : {}),
    value: exemplar.value,
    tsMs: exemplar.ts.getTime(),
  };
}

/** Rehydrate a stored exemplar (epoch ms) back into a normalized {@link MetricExemplar}. */
export function fromStoredExemplar(stored: StoredExemplar): MetricExemplar {
  return {
    traceId: stored.traceId,
    ...(stored.spanId ? { spanId: stored.spanId } : {}),
    value: stored.value,
    ts: new Date(stored.tsMs),
  };
}

/**
 * Merge stored exemplars, keeping the newest {@link MAX_EXEMPLARS_PER_POINT} by
 * timestamp and DEDUPING by trace id (the same trace is one jump-off, not many).
 * Used both to fold a flush's exemplars per series and to bound the persisted
 * set. Pure.
 */
export function mergeExemplars({
  parts,
  cap = MAX_EXEMPLARS_PER_POINT,
}: {
  parts: StoredExemplar[];
  cap?: number;
}): StoredExemplar[] {
  const byNewest = parts.toSorted((a, b) => b.tsMs - a.tsMs);
  const seen = new Set<string>();
  const out: StoredExemplar[] = [];
  for (const e of byNewest) {
    if (seen.has(e.traceId)) continue;
    seen.add(e.traceId);
    out.push(e);
    if (out.length >= cap) break;
  }
  return out;
}

/** One series' exemplars observed in a flush, merged into `last_exemplars`. */
export interface SeriesExemplarUpdate {
  seriesId: string;
  exemplars: StoredExemplar[];
}

/**
 * MERGE this flush's exemplars into each series' stored `last_exemplars`,
 * keeping the newest {@link MAX_EXEMPLARS_PER_POINT} deduped by trace id. Called
 * only for series that carried exemplars in THIS flush; a series that flushed
 * NONE is not in `updates` and keeps its last known jump-off intact. Merging
 * (rather than overwriting) is what lets a series flushing one exemplar per
 * interval retain its older jump-offs so the chart's window union still finds
 * them.
 *
 * Batched: one chunked `SELECT` reads the affected series' stored sets, the
 * merge happens in JS, then a single `UPDATE ... FROM (VALUES ...)` per chunk
 * writes them all - not one `UPDATE` per series inside the flush transaction.
 * Best-effort last-write-wins across pods - an exemplar is a convenience
 * pointer, not a source of truth, so a racing merge is fine.
 */
export async function updateSeriesExemplars({
  runner,
  updates,
}: {
  runner: Runner;
  updates: SeriesExemplarUpdate[];
}): Promise<void> {
  const withExemplars = updates.filter((u) => u.exemplars.length > 0);
  if (withExemplars.length === 0) return;

  for (const part of chunk({ items: withExemplars, size: STORAGE_CHUNK_SIZE })) {
    const ids = part.map((u) => u.seriesId);
    // Read the currently-stored exemplars for the affected series so this flush
    // MERGES with them instead of clobbering older jump-offs.
    const existingRows = await runner
      .select({ id: metricSeries.id, lastExemplars: metricSeries.lastExemplars })
      .from(metricSeries)
      .where(inArray(metricSeries.id, ids));
    const storedById = new Map<string, StoredExemplar[]>(
      existingRows.map((row) => [row.id, row.lastExemplars ?? []]),
    );

    const valueRows = part.map((u) => {
      const merged = mergeExemplars({
        parts: [...(storedById.get(u.seriesId) ?? []), ...u.exemplars],
      });
      // Cast each row's exemplars to jsonb so the VALUES column types match the
      // `last_exemplars` jsonb column.
      return sql`(${u.seriesId}, ${JSON.stringify(merged)}::jsonb)`;
    });

    await runner.execute(sql`
      UPDATE ${metricSeries} AS m
      SET last_exemplars = v.exemplars
      FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, exemplars)
      WHERE m.id = v.id
    `);
  }
}

/**
 * Union the stored exemplars of a set of series that fall within `[from, to)`,
 * deduped by trace id and capped to the newest `limit` - the chart's
 * click-through-to-trace markers for a `(metricName, labelFilters)` selection.
 * Only rows with a non-null `last_exemplars` are scanned; chunked over the id set.
 */
export async function readSeriesExemplars({
  runner,
  seriesIds,
  from,
  to,
  limit,
}: {
  runner: Runner;
  seriesIds: string[];
  from: Date;
  to: Date;
  limit: number;
}): Promise<MetricExemplar[]> {
  if (seriesIds.length === 0) return [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const collected: StoredExemplar[] = [];
  for (const part of chunk({ items: seriesIds, size: STORAGE_CHUNK_SIZE })) {
    const rows = await runner
      .select({ lastExemplars: metricSeries.lastExemplars })
      .from(metricSeries)
      .where(
        and(inArray(metricSeries.id, part), isNotNull(metricSeries.lastExemplars)),
      );
    for (const row of rows) {
      for (const e of row.lastExemplars ?? []) {
        if (e.tsMs >= fromMs && e.tsMs < toMs) collected.push(e);
      }
    }
  }
  return mergeExemplars({ parts: collected, cap: limit }).map((e) =>
    fromStoredExemplar(e),
  );
}
