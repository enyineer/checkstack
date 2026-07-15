import type { ScopedQueryRunner } from "@checkstack/backend-api";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type {
  SearchTraces,
  SearchTracesResult,
  TraceSummary,
} from "@checkstack/tracestream-common";
import * as schema from "../../schema";
import { traceSummaries } from "../../schema";
import type {
  StreamSummaryCounts,
  SummaryFlushInput,
  TraceSummaryStore,
} from "../ports";
import type { DecisionCandidate } from "../decision";
import { chunk, floorToHour, STORAGE_CHUNK_SIZE, RETENTION_DELETE_BATCH } from "../time";

type Runner = ScopedQueryRunner<typeof schema>;

type SummaryRow = typeof traceSummaries.$inferSelect;

function mapRow(row: SummaryRow): TraceSummary {
  return {
    traceId: row.traceId,
    rootServiceName: row.rootServiceName,
    rootSpanName: row.rootSpanName,
    startTs: row.startTs,
    durationMs: row.durationMs,
    spanCount: row.spanCount,
    errorSpanCount: row.errorSpanCount,
    hasError: row.hasError,
    retained: row.retained,
    lastSpanAt: row.lastSpanAt,
  };
}

/**
 * Pre-aggregate a flush batch by `(streamId, traceId)` in JS: Postgres rejects
 * an ON CONFLICT whose single statement proposes two rows with the same conflict
 * target, so identical traces in one flush MUST be folded here first (with the
 * SAME rules the SQL upsert applies against an existing row).
 */
function foldBatch(summaries: SummaryFlushInput[]): SummaryFlushInput[] {
  const byKey = new Map<string, SummaryFlushInput>();
  for (const s of summaries) {
    const key = `${s.streamId} ${s.traceId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...s });
      continue;
    }
    // Date comparison, NOT Math.min/max (those coerce Dates to numbers).
    if (s.startTs < existing.startTs) existing.startTs = s.startTs;
    if (s.lastSpanAt > existing.lastSpanAt) existing.lastSpanAt = s.lastSpanAt;
    existing.spanCount += s.spanCount;
    existing.errorSpanCount += s.errorSpanCount;
    existing.hasError = existing.hasError || s.hasError;
    existing.rootServiceName = existing.rootServiceName ?? s.rootServiceName;
    existing.rootSpanName = existing.rootSpanName ?? s.rootSpanName;
  }
  return [...byKey.values()];
}

export function createTraceSummaryStore({ runner }: { runner: Runner }): TraceSummaryStore {
  return {
    async upsertFromFlush({ summaries }) {
      if (summaries.length === 0) return;
      const folded = foldBatch(summaries);
      for (const part of chunk({ items: folded, size: STORAGE_CHUNK_SIZE })) {
        await runner
          .insert(traceSummaries)
          .values(
            part.map((s) => ({
              streamId: s.streamId,
              traceId: s.traceId,
              rootServiceName: s.rootServiceName,
              rootSpanName: s.rootSpanName,
              startTs: s.startTs,
              // First-insert duration; the upsert recomputes from timestamps.
              durationMs: Math.max(
                0,
                s.lastSpanAt.getTime() - s.startTs.getTime(),
              ),
              spanCount: s.spanCount,
              errorSpanCount: s.errorSpanCount,
              hasError: s.hasError,
              retained: null,
              decidedAt: null,
              lastSpanAt: s.lastSpanAt,
            })),
          )
          .onConflictDoUpdate({
            target: [traceSummaries.streamId, traceSummaries.traceId],
            set: {
              startTs: sql`least(${traceSummaries.startTs}, excluded.start_ts)`,
              lastSpanAt: sql`greatest(${traceSummaries.lastSpanAt}, excluded.last_span_at)`,
              // duration = union extent = max(end) - min(start), in ms.
              durationMs: sql`extract(epoch from (greatest(${traceSummaries.lastSpanAt}, excluded.last_span_at) - least(${traceSummaries.startTs}, excluded.start_ts))) * 1000`,
              spanCount: sql`${traceSummaries.spanCount} + excluded.span_count`,
              errorSpanCount: sql`${traceSummaries.errorSpanCount} + excluded.error_span_count`,
              hasError: sql`${traceSummaries.hasError} or excluded.has_error`,
              rootServiceName: sql`coalesce(${traceSummaries.rootServiceName}, excluded.root_service_name)`,
              rootSpanName: sql`coalesce(${traceSummaries.rootSpanName}, excluded.root_span_name)`,
            },
          });
      }
    },

    async listUndecidedReadyForDecision({ streamId, olderThan, limit }) {
      const rows = await runner
        .select({
          traceId: traceSummaries.traceId,
          hasError: traceSummaries.hasError,
          durationMs: traceSummaries.durationMs,
          startTs: traceSummaries.startTs,
        })
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            isNull(traceSummaries.retained),
            lte(traceSummaries.lastSpanAt, olderThan),
          ),
        )
        .orderBy(asc(traceSummaries.lastSpanAt))
        .limit(limit);
      return rows satisfies DecisionCandidate[];
    },

    async markDecided({ streamId, traceIds, retained, decidedAt }) {
      if (traceIds.length === 0) return;
      for (const part of chunk({ items: traceIds, size: STORAGE_CHUNK_SIZE })) {
        await runner
          .update(traceSummaries)
          .set({ retained, decidedAt })
          .where(
            and(
              eq(traceSummaries.streamId, streamId),
              inArray(traceSummaries.traceId, part),
            ),
          );
      }
    },

    async countRetainedByHour({ streamId, hourStarts }) {
      const out = new Map<number, number>();
      if (hourStarts.length === 0) return out;
      const wanted = new Set(hourStarts.map((h) => floorToHour(h).getTime()));
      const epochs = [...wanted];
      const from = new Date(Math.min(...epochs));
      const to = new Date(Math.max(...epochs) + 3_600_000);
      // Floor to the hour in UTC via epoch math, NOT `date_trunc('hour', ...)`:
      // date_trunc truncates in the session time zone, whose boundaries do not
      // match `floorToHour`'s UTC keys (and half-hour-offset zones never align).
      // `extract(epoch ...)` is TZ-independent (seconds since the UTC epoch).
      const hourEpochSeconds = sql<string>`floor(extract(epoch from ${traceSummaries.startTs}) / 3600) * 3600`;
      const rows = await runner
        .select({
          hourEpochSeconds,
          count: sql<string>`count(*)`,
        })
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            eq(traceSummaries.retained, true),
            gte(traceSummaries.startTs, from),
            lt(traceSummaries.startTs, to),
          ),
        )
        .groupBy(hourEpochSeconds);
      for (const row of rows) {
        const epoch = Number(row.hourEpochSeconds) * 1000;
        if (wanted.has(epoch)) out.set(epoch, Number(row.count));
      }
      return out;
    },

    async searchSummaries(input: SearchTraces): Promise<SearchTracesResult> {
      const conditions = [
        eq(traceSummaries.streamId, input.streamId),
        gte(traceSummaries.startTs, input.from),
        lt(traceSummaries.startTs, input.to),
      ];
      if (input.serviceName) {
        conditions.push(eq(traceSummaries.rootServiceName, input.serviceName));
      }
      if (input.spanName) {
        conditions.push(eq(traceSummaries.rootSpanName, input.spanName));
      }
      if (input.status === "error") {
        conditions.push(eq(traceSummaries.hasError, true));
      } else if (input.status === "ok") {
        conditions.push(eq(traceSummaries.hasError, false));
      }
      if (input.minDurationMs !== undefined) {
        conditions.push(gte(traceSummaries.durationMs, input.minDurationMs));
      }
      if (input.maxDurationMs !== undefined) {
        conditions.push(lte(traceSummaries.durationMs, input.maxDurationMs));
      }
      if (input.traceId) {
        conditions.push(eq(traceSummaries.traceId, input.traceId));
      }
      if (input.cursor) {
        // Keyset on (startTs desc, traceId desc): page strictly after the cursor.
        conditions.push(
          or(
            lt(traceSummaries.startTs, input.cursor.startTs),
            and(
              eq(traceSummaries.startTs, input.cursor.startTs),
              lt(traceSummaries.traceId, input.cursor.traceId),
            ),
          )!,
        );
      }
      const rows = await runner
        .select()
        .from(traceSummaries)
        .where(and(...conditions))
        .orderBy(desc(traceSummaries.startTs), desc(traceSummaries.traceId))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > input.limit && last
          ? { startTs: last.startTs, traceId: last.traceId }
          : null;
      return { traces: page.map((row) => mapRow(row)), nextCursor };
    },

    async getSummary({ streamId, traceId }) {
      const [row] = await runner
        .select()
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            eq(traceSummaries.traceId, traceId),
          ),
        )
        .limit(1);
      return row ? mapRow(row) : null;
    },

    async findByTraceId({ traceId }) {
      const rows = await runner
        .select()
        .from(traceSummaries)
        .where(eq(traceSummaries.traceId, traceId));
      return rows.map((row) => ({ streamId: row.streamId, summary: mapRow(row) }));
    },

    async listUnretainedTracesBefore({ streamId, cutoff, limit }) {
      const rows = await runner
        .select({ traceId: traceSummaries.traceId })
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            eq(traceSummaries.retained, false),
            lt(traceSummaries.lastSpanAt, cutoff),
          ),
        )
        .orderBy(asc(traceSummaries.lastSpanAt))
        .limit(limit);
      return rows.map((r) => r.traceId);
    },

    async overviewTotals({ streamId, since }) {
      const [row] = await runner
        .select({
          spans: sql<string>`coalesce(sum(${traceSummaries.spanCount}), 0)`,
          traces: sql<string>`count(*)`,
          errorTraces: sql<string>`count(*) filter (where ${traceSummaries.hasError})`,
          retainedTraces: sql<string>`count(*) filter (where ${traceSummaries.retained})`,
        })
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            gte(traceSummaries.startTs, since),
          ),
        );
      return {
        spans: Number(row?.spans ?? 0),
        traces: Number(row?.traces ?? 0),
        errorTraces: Number(row?.errorTraces ?? 0),
        retainedTraces: Number(row?.retainedTraces ?? 0),
      };
    },

    async slowestRetained({ streamId, since, limit }) {
      const rows = await runner
        .select()
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.streamId, streamId),
            eq(traceSummaries.retained, true),
            gte(traceSummaries.startTs, since),
          ),
        )
        .orderBy(desc(traceSummaries.durationMs))
        .limit(limit);
      return rows.map((row) => mapRow(row));
    },

    async countsForStreams({ streamIds, since }) {
      if (streamIds.length === 0) return [] satisfies StreamSummaryCounts[];
      const rows = await runner
        .select({
          streamId: traceSummaries.streamId,
          traces24h: sql<string>`count(*)`,
          errorTraces24h: sql<string>`count(*) filter (where ${traceSummaries.hasError})`,
        })
        .from(traceSummaries)
        .where(
          and(
            inArray(traceSummaries.streamId, streamIds),
            gte(traceSummaries.startTs, since),
          ),
        )
        .groupBy(traceSummaries.streamId);
      return rows.map((r) => ({
        streamId: r.streamId,
        traces24h: Number(r.traces24h),
        errorTraces24h: Number(r.errorTraces24h),
      }));
    },

    async deleteSummariesBefore({
      streamId,
      cutoff,
      limit = RETENTION_DELETE_BATCH,
    }) {
      let deleted = 0;
      for (;;) {
        const rows = await runner
          .select({ traceId: traceSummaries.traceId })
          .from(traceSummaries)
          .where(
            and(
              eq(traceSummaries.streamId, streamId),
              lt(traceSummaries.startTs, cutoff),
            ),
          )
          .limit(limit);
        if (rows.length === 0) break;
        await runner
          .delete(traceSummaries)
          .where(
            and(
              eq(traceSummaries.streamId, streamId),
              inArray(
                traceSummaries.traceId,
                rows.map((r) => r.traceId),
              ),
            ),
          );
        deleted += rows.length;
        if (rows.length < limit) break;
      }
      return deleted;
    },

    async deleteAllForStream({ streamId }) {
      await runner
        .delete(traceSummaries)
        .where(eq(traceSummaries.streamId, streamId));
    },
  };
}
