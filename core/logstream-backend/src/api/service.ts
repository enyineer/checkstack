import { ORPCError } from "@orpc/server";
import { and, or, eq, ilike, inArray, lt, gte, lte, desc, sql } from "drizzle-orm";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
  EventBus,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { AuthApi } from "@checkstack/auth-common";
import {
  LogStreamConfigSchema,
  bandFromSeverityNumber,
  logstreamResourceTypes,
  normalizeTraceId,
  MAX_TRACE_CORRELATION_STREAMS,
  type LogStream,
  type CreateLogStream,
  type UpdateLogStream,
  type SearchEvents,
  type SearchEventsResult,
  type FindEventsByTraceId,
  type FindEventsByTraceIdResult,
  type LogEvent,
  type EventCursor,
  type GetBuckets,
  type SeverityBucketsResult,
  type PatternBucketsResult,
  type LogPattern,
  type ListImportantEvents,
  type ListImportantEventsResult,
  type ImportantEvent,
  type StreamOverview,
  type StreamForPicker,
  type LogStreamSummary,
  type IngestCounters,
  type StreamSeverityTotals,
  type SeverityBand,
  type CreatePattern,
  type DeletePattern,
  type ListPatterns,
  type SetPatternHidden,
  type TestPattern,
  type TestPatternResult,
  type MaskLine,
  type MaskLineResult,
  type ListPatternVariables,
  type ListPatternVariablesResult,
} from "@checkstack/logstream-common";
import type {
  ListSystemLinksResult,
  ListStreamsForSystemResult,
  ListLinkedStreamStatusesResult,
} from "@checkstack/telemetry-common";
import type { ListServiceNamesResult } from "@checkstack/logstream-common";
import {
  createPatternOperations,
  type PatternOperations,
} from "./patterns";
import {
  createSystemLinkOperations,
  type SystemLinkOperations,
} from "./system-links";
import type { FindReferencingChecks } from "../health/pattern-references";
import * as schema from "../schema";
import {
  logStreams,
  logEvents,
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
  logImportantEvents,
  logStreamActivity,
  logStreamSystemLinks,
} from "../schema";
import type { Storage } from "../storage";
import {
  resolveGrain,
  rollupBoundary,
  partitionWindowAtBoundary,
  sumSeverityPointsByHour,
  sumPatternPointsByHour,
  addSeverityTotals,
  ZERO_SEVERITY_TOTALS,
} from "./buckets-merge";

/** How many raw rows to delete per statement in the deleteStream cascade. */
const EVENT_DELETE_BATCH = 10_000;

/** Top-patterns count surfaced on the overview page. */
const OVERVIEW_TOP_PATTERNS = 5;

/**
 * A read-only accessor the ingest area MAY expose so the overview page can show
 * per-pod ingest counters. Undefined until the ingest agent wires it; the
 * service then returns `null` counters (durable rates still come from buckets).
 */
export type IngestCountersReader = (streamId: string) => IngestCounters | null;

/**
 * The logstream read/write service. The router is a thin pass-through; all DB
 * work (via the storage read helpers plus a few keyset/search queries of its
 * own) lives here. RLAC is enforced by the contract's `instanceAccess` in the
 * auth middleware, so the service does NOT re-check grants - it only reads/writes.
 */
export interface LogstreamService {
  createStream(input: CreateLogStream): Promise<LogStream>;
  updateStream(input: { id: string; body: UpdateLogStream }): Promise<LogStream>;
  deleteStream(input: { id: string }): Promise<void>;
  listStreams(): Promise<{ streams: LogStream[] }>;
  listStreamSummaries(): Promise<{ summaries: LogStreamSummary[] }>;
  getStream(input: { id: string }): Promise<LogStream>;
  listStreamsForPicker(): Promise<StreamForPicker[]>;

  searchEvents(input: SearchEvents): Promise<SearchEventsResult>;
  findEventsByTraceId(
    input: FindEventsByTraceId,
  ): Promise<FindEventsByTraceIdResult>;
  getSeverityBuckets(input: GetBuckets): Promise<SeverityBucketsResult>;
  getPatternBuckets(input: GetBuckets): Promise<PatternBucketsResult>;
  listPatterns(input: ListPatterns): Promise<LogPattern[]>;

  // Custom patterns (see ./patterns).
  createPattern(input: CreatePattern): Promise<LogPattern>;
  deletePattern(input: DeletePattern): Promise<void>;
  setPatternHidden(input: SetPatternHidden): Promise<LogPattern>;
  testPattern(input: TestPattern): Promise<TestPatternResult>;
  maskLine(input: MaskLine): Promise<MaskLineResult>;
  listPatternVariables(
    input: ListPatternVariables,
  ): Promise<ListPatternVariablesResult>;

  listImportantEvents(
    input: ListImportantEvents,
  ): Promise<ListImportantEventsResult>;
  getStreamOverview(input: { streamId: string }): Promise<StreamOverview>;

  // System links (explicit stream -> catalog-system mapping; see ./system-links).
  listSystemLinks(input: { streamId: string }): Promise<ListSystemLinksResult>;
  getSystemLinksForUpdate(input: {
    streamId: string;
  }): Promise<ListSystemLinksResult>;
  setSystemLinks(input: {
    streamId: string;
    systemIds: string[];
  }): Promise<void>;
  listStreamsForSystem(input: {
    systemId: string;
  }): Promise<ListStreamsForSystemResult>;
  listLinkedStreamStatuses(input: {
    systemIds: string[];
  }): Promise<ListLinkedStreamStatusesResult>;
  listServiceNames(input: {
    streamId: string;
  }): Promise<ListServiceNamesResult>;
}

export function createLogstreamService({
  db,
  storage,
  logger,
  rpcClient,
  sourceLifecycle,
  eventBus,
  ingestCounters,
  findReferencingChecks,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  logger: Logger;
  /**
   * Platform RPC client, used to clean up the deleted stream's team grants via
   * auth's `deleteObjectRelations`. Optional so lightweight tests can omit it;
   * when absent, `deleteStream` logs a warning and skips grant cleanup (the DB
   * cascade still runs).
   */
  rpcClient?: RpcClient;
  /**
   * Telemetry source-lifecycle service. `deleteStream` calls
   * `handleStreamDeleted` best-effort after the stream's own rows and grants are
   * gone, so the platform strips the deleted stream's binding from every source
   * and fully deletes sources left binding-less. Optional so lightweight tests
   * can omit it; when absent, `deleteStream` logs a warning and skips the
   * cascade (the stream deletion itself already succeeded).
   */
  sourceLifecycle?: TelemetrySourceLifecycle;
  /**
   * Platform event bus, forwarded to the pattern operations so a
   * `createPattern` / `deletePattern` broadcasts `logstream.patterns.changed`
   * to every pod's Drain tree. Optional so lightweight tests can omit it; a pod
   * that misses the event still converges on its next hydration.
   */
  eventBus?: EventBus;
  /** Optional per-pod ingest counter accessor (see {@link IngestCountersReader}). */
  ingestCounters?: IngestCountersReader;
  /**
   * Resolve the health-check names that reference a pattern, so `deletePattern`
   * can refuse (409) and name them. Defaults to "no references" (safe when the
   * platform has no health-check RPC wired - no checks can exist then).
   */
  findReferencingChecks?: FindReferencingChecks;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}): LogstreamService {
  const patternOps: PatternOperations = createPatternOperations({
    db,
    eventBus,
    logger,
    findReferencingChecks: findReferencingChecks ?? (async () => []),
    now,
  });

  const systemLinkOps: SystemLinkOperations = createSystemLinkOperations({
    db,
    now,
  });

  async function getStreamRowOrThrow(id: string) {
    const [row] = await db
      .select()
      .from(logStreams)
      .where(eq(logStreams.id, id))
      .limit(1);
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Log stream not found" });
    }
    return row;
  }

  /**
   * Cross-tier severity sum over `[from, to)`: the part older than the rollup
   * boundary from the hourly tier, the newer part from the minute tier, added.
   */
  async function sumSeverityMerged({
    streamId,
    from,
    to,
    minuteRetentionHours,
  }: {
    streamId: string;
    from: Date;
    to: Date;
    minuteRetentionHours: number;
  }): Promise<StreamSeverityTotals> {
    const boundary = rollupBoundary({ now: now(), minuteRetentionHours });
    const { coarse, fine } = partitionWindowAtBoundary({ from, to, boundary });
    return withScopedTransaction(db, async (tx) => {
      let totals = ZERO_SEVERITY_TOTALS;
      if (coarse) {
        totals = addSeverityTotals(
          totals,
          await storage.sumSeverityBands({
            runner: tx,
            streamId,
            from: coarse.from,
            to: coarse.to,
            grain: "hour",
          }),
        );
      }
      if (fine) {
        totals = addSeverityTotals(
          totals,
          await storage.sumSeverityBands({
            runner: tx,
            streamId,
            from: fine.from,
            to: fine.to,
            grain: "minute",
          }),
        );
      }
      return totals;
    });
  }

  return {
    async createStream(input) {
      const config = LogStreamConfigSchema.parse(input.config ?? {});
      const id = crypto.randomUUID();
      const [row] = await db
        .insert(logStreams)
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          config,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create log stream",
        });
      }
      return mapStreamRow(row);
    },

    async updateStream({ id, body }) {
      const existing = await getStreamRowOrThrow(id);
      const nextConfig = body.config
        ? LogStreamConfigSchema.parse({ ...existing.config, ...body.config })
        : existing.config;
      const [row] = await db
        .update(logStreams)
        .set({
          name: body.name ?? existing.name,
          description:
            body.description === undefined
              ? existing.description
              : body.description,
          config: nextConfig,
          updatedAt: now(),
        })
        .where(eq(logStreams.id, id))
        .returning();
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Log stream not found" });
      }
      return mapStreamRow(row);
    },

    async deleteStream({ id }) {
      // Explicit cascade: there are NO FKs (Foundation deviation #2), so every
      // stream-scoped table is cleared by hand in ONE transaction. The
      // high-volume raw table is deleted in bounded batches; the aggregate
      // tables (bounded by retention) go in a single statement each.
      //
      // Push SOURCES bound to this stream are NOT touched here: the telemetry
      // platform owns push-instance lifecycle (deleting a stream does not
      // cascade to its bound sources - the operator deletes/re-binds them in the
      // Sources UI), so this cascade only clears logstream's own tables.
      await withScopedTransaction(db, async (tx) => {
        // Batched delete of the raw lines (potentially millions of rows).
        for (;;) {
          const batch = await tx
            .select({ eventId: logEvents.id })
            .from(logEvents)
            .where(eq(logEvents.streamId, id))
            .limit(EVENT_DELETE_BATCH);
          if (batch.length === 0) break;
          await tx.delete(logEvents).where(
            inArray(
              logEvents.id,
              batch.map((r) => r.eventId),
            ),
          );
          if (batch.length < EVENT_DELETE_BATCH) break;
        }

        // Single-statement deletes for the bounded child tables.
        await tx
          .delete(logSeverityBuckets)
          .where(eq(logSeverityBuckets.streamId, id));
        await tx
          .delete(logPatternBuckets)
          .where(eq(logPatternBuckets.streamId, id));
        await tx
          .delete(logSeverityHourly)
          .where(eq(logSeverityHourly.streamId, id));
        await tx
          .delete(logPatternHourly)
          .where(eq(logPatternHourly.streamId, id));
        await tx.delete(logPatterns).where(eq(logPatterns.streamId, id));
        await tx
          .delete(logImportantEvents)
          .where(eq(logImportantEvents.streamId, id));
        await tx
          .delete(logStreamActivity)
          .where(eq(logStreamActivity.streamId, id));
        await tx
          .delete(logStreamSystemLinks)
          .where(eq(logStreamSystemLinks.streamId, id));
        await tx.delete(logStreams).where(eq(logStreams.id, id));
      });

      // Also clear the stream's ReBAC team grants so they don't orphan (the
      // stream row is gone; a grant to `logstream.stream:<id>` would dangle in
      // the relation-tuple store). Best-effort: the DB cascade already
      // committed, so an auth-RPC failure is logged, not rethrown.
      await deleteStreamGrants({ rpcClient, streamId: id, logger });

      // Cascade the deletion to the telemetry platform: strip this stream's
      // binding from every source and fully delete sources left binding-less
      // (secrets, schedule, push-token revoke). Best-effort for the same reason
      // as the grant cleanup - the stream's own deletion already succeeded.
      await cascadeSourceDeletion({
        sourceLifecycle,
        signal: "logs",
        streamId: id,
        logger,
      });
    },

    async listStreams() {
      const rows = await db.select().from(logStreams);
      return { streams: rows.map((row) => mapStreamRow(row)) };
    },

    async listStreamSummaries() {
      // ONE set-based batch, no per-stream loops: base the rows on every
      // stream (so a zero-activity stream still appears), then LEFT-fold three
      // grouped aggregates - the activity row, the last-24h error/warn severity
      // sums (cross-tier: minute AND hourly, summed - the two tiers never hold
      // the same physical row once rolled up), and the pattern count. All read
      // under one scoped transaction. `listKey` then filters by each summary's
      // `id` (the stream id) to the caller's readable set.
      const to = now();
      const from = new Date(to.getTime() - 24 * 3_600_000);
      const bands: SeverityBand[] = ["error", "warn"];
      const summaries = await withScopedTransaction(db, async (tx) => {
        // SEQUENTIAL on purpose: all five queries share this transaction's ONE
        // pg client, and pg serializes (and deprecates, removing in pg@9)
        // concurrent client.query() calls - a Promise.all here is fake
        // parallelism that emits DeprecationWarnings. Parallelize only across
        // POOL clients (standalone scoped queries), never within a tx.
        const streamRows = await tx
          .select({ id: logStreams.id })
          .from(logStreams);
        const activityRows = await tx
          .select({
            streamId: logStreamActivity.streamId,
            lastReceivedAt: logStreamActivity.lastReceivedAt,
          })
          .from(logStreamActivity);
        const minuteRows = await tx
          .select({
            streamId: logSeverityBuckets.streamId,
            band: logSeverityBuckets.band,
            total: sql<string>`sum(${logSeverityBuckets.count})`,
          })
          .from(logSeverityBuckets)
          .where(
            and(
              gte(logSeverityBuckets.bucketStart, from),
              inArray(logSeverityBuckets.band, bands),
            ),
          )
          .groupBy(logSeverityBuckets.streamId, logSeverityBuckets.band);
        const hourlyRows = await tx
          .select({
            streamId: logSeverityHourly.streamId,
            band: logSeverityHourly.band,
            total: sql<string>`sum(${logSeverityHourly.count})`,
          })
          .from(logSeverityHourly)
          .where(
            and(
              gte(logSeverityHourly.bucketStart, from),
              inArray(logSeverityHourly.band, bands),
            ),
          )
          .groupBy(logSeverityHourly.streamId, logSeverityHourly.band);
        const patternRows = await tx
          .select({
            streamId: logPatterns.streamId,
            count: sql<string>`count(*)`,
          })
          .from(logPatterns)
          .groupBy(logPatterns.streamId);
        return assembleStreamSummaries({
          streamIds: streamRows.map((r) => r.id),
          activity: activityRows,
          severity: [...minuteRows, ...hourlyRows],
          patternCounts: patternRows,
        });
      });
      return { summaries };
    },

    async getStream({ id }) {
      return mapStreamRow(await getStreamRowOrThrow(id));
    },

    async listStreamsForPicker() {
      const rows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreams)
        .orderBy(logStreams.name);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },

    async searchEvents(input) {
      const conditions = [eq(logEvents.streamId, input.streamId)];
      if (input.text) {
        conditions.push(ilike(logEvents.body, `%${escapeLikePattern(input.text)}%`));
      }
      if (input.severityBands && input.severityBands.length > 0) {
        conditions.push(inArray(logEvents.band, input.severityBands));
      }
      if (input.patternId) {
        conditions.push(eq(logEvents.patternId, input.patternId));
      }
      if (input.traceId !== undefined) {
        // Stored trace ids are normalized (dash-stripped, lowercased) at the
        // flush seam, so the query input must be normalized the SAME way to
        // match. An input that normalizes to nothing can match no row.
        const normalized = normalizeTraceId(input.traceId);
        if (normalized === undefined) {
          return { events: [], nextCursor: null };
        }
        conditions.push(eq(logEvents.traceId, normalized));
      }
      if (input.from) conditions.push(gte(logEvents.ts, input.from));
      if (input.to) conditions.push(lte(logEvents.ts, input.to));
      if (input.cursor) {
        const cursorId = Number(input.cursor.id);
        conditions.push(
          or(
            lt(logEvents.ts, input.cursor.ts),
            and(
              eq(logEvents.ts, input.cursor.ts),
              lt(logEvents.id, cursorId),
            ),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(logEvents)
        .where(and(...conditions))
        .orderBy(desc(logEvents.ts), desc(logEvents.id))
        .limit(input.limit);
      const events = rows.map((row) => mapEventRow(row));
      return { events, nextCursor: nextCursorFor(events, input.limit) };
    },

    async findEventsByTraceId({ traceId: rawTraceId, from, to, limitPerStream }) {
      // Stored ids are normalized at the flush seam; normalize the input the
      // SAME way so an operator pasting a dashed/uppercase id still matches. An
      // input that normalizes to nothing can match no row.
      const traceId = normalizeTraceId(rawTraceId);
      if (traceId === undefined) return { matches: [] };

      // `from`/`to` are REQUIRED by the contract, so every scan is ts-bounded
      // and rides the partial `(trace_id, ts)` index - a degenerate id shared by
      // millions of rows can never turn this into a full ranking scan.
      const windowConditions = and(
        eq(logEvents.traceId, traceId),
        gte(logEvents.ts, from),
        lte(logEvents.ts, to),
      );

      // 1) The streams carrying this trace in-window, ranked by their newest
      //    matching event and capped at MAX_TRACE_CORRELATION_STREAMS. This
      //    bounds the number of GROUPS (and the ranking scan below) even if a
      //    degenerate extraction rule stamped one "trace id" across many streams.
      const topStreams = await db
        .select({ streamId: logEvents.streamId })
        .from(logEvents)
        .where(windowConditions)
        .groupBy(logEvents.streamId)
        .orderBy(
          sql`max(${logEvents.ts}) desc`,
          // Tiebreak on the newest row's id (a global identity, unique per
          // stream) so the cap is deterministic when two streams' newest events
          // share a ts.
          sql`max(${logEvents.id}) desc`,
        )
        .limit(MAX_TRACE_CORRELATION_STREAMS);
      if (topStreams.length === 0) return { matches: [] };
      const boundedStreamIds = topStreams.map((s) => s.streamId);

      // 2) Per-stream newest-first events for ONLY those bounded streams, keeping
      //    at most `limitPerStream` per stream via a window rank. Total rows are
      //    thus bounded by MAX_TRACE_CORRELATION_STREAMS * limitPerStream.
      const ranked = db
        .select({
          id: logEvents.id,
          streamId: logEvents.streamId,
          ts: logEvents.ts,
          observedAt: logEvents.observedAt,
          severityNumber: logEvents.severityNumber,
          severityText: logEvents.severityText,
          band: logEvents.band,
          body: logEvents.body,
          attributes: logEvents.attributes,
          resource: logEvents.resource,
          patternId: logEvents.patternId,
          traceId: logEvents.traceId,
          spanId: logEvents.spanId,
          rn: sql<number>`row_number() over (partition by ${logEvents.streamId} order by ${logEvents.ts} desc, ${logEvents.id} desc)`.as(
            "rn",
          ),
        })
        .from(logEvents)
        .where(and(windowConditions, inArray(logEvents.streamId, boundedStreamIds)))
        .as("ranked");

      const rows = await db
        .select()
        .from(ranked)
        .where(lte(ranked.rn, limitPerStream))
        .orderBy(desc(ranked.ts), desc(ranked.id));

      // Group the (already newest-first) rows per stream; the global DESC order
      // preserves per-stream DESC order, so each group stays newest-first.
      const eventsByStream = new Map<string, LogEvent[]>();
      for (const row of rows) {
        const group = eventsByStream.get(row.streamId);
        if (group) group.push(mapEventRow(row));
        else eventsByStream.set(row.streamId, [mapEventRow(row)]);
      }

      const streamIds = [...eventsByStream.keys()];
      if (streamIds.length === 0) return { matches: [] };

      // Resolve stream names in one batch. `id` on each match IS the stream id -
      // the field the `listKey` RLAC filter post-filters on.
      const nameRows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreams)
        .where(inArray(logStreams.id, streamIds));
      const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

      return {
        matches: streamIds.map((id) => ({
          id,
          streamName: nameById.get(id) ?? id,
          events: eventsByStream.get(id)!,
        })),
      };
    },

    async getSeverityBuckets(input) {
      const grain = resolveGrain({
        from: input.from,
        to: input.to,
        explicit: input.grain,
      });
      if (grain === "minute") {
        const points = await storage.readSeverityBuckets({
          runner: db,
          streamId: input.streamId,
          from: input.from,
          to: input.to,
          grain: "minute",
        });
        return { grain, points };
      }
      const stream = await getStreamRowOrThrow(input.streamId);
      const boundary = rollupBoundary({
        now: now(),
        minuteRetentionHours: stream.config.minuteRetentionHours,
      });
      const { coarse, fine } = partitionWindowAtBoundary({
        from: input.from,
        to: input.to,
        boundary,
      });
      const points = await withScopedTransaction(db, async (tx) => {
        const parts = [];
        if (coarse) {
          parts.push(
            ...(await storage.readSeverityBuckets({
              runner: tx,
              streamId: input.streamId,
              from: coarse.from,
              to: coarse.to,
              grain: "hour",
            })),
          );
        }
        if (fine) {
          parts.push(
            ...(await storage.readSeverityBuckets({
              runner: tx,
              streamId: input.streamId,
              from: fine.from,
              to: fine.to,
              grain: "minute",
            })),
          );
        }
        return sumSeverityPointsByHour(parts);
      });
      return { grain: "hour", points };
    },

    async getPatternBuckets(input) {
      const grain = resolveGrain({
        from: input.from,
        to: input.to,
        explicit: input.grain,
      });
      if (grain === "minute") {
        const points = await storage.readPatternBuckets({
          runner: db,
          streamId: input.streamId,
          from: input.from,
          to: input.to,
          grain: "minute",
        });
        return { grain, points };
      }
      const stream = await getStreamRowOrThrow(input.streamId);
      const boundary = rollupBoundary({
        now: now(),
        minuteRetentionHours: stream.config.minuteRetentionHours,
      });
      const { coarse, fine } = partitionWindowAtBoundary({
        from: input.from,
        to: input.to,
        boundary,
      });
      const points = await withScopedTransaction(db, async (tx) => {
        const parts = [];
        if (coarse) {
          parts.push(
            ...(await storage.readPatternBuckets({
              runner: tx,
              streamId: input.streamId,
              from: coarse.from,
              to: coarse.to,
              grain: "hour",
            })),
          );
        }
        if (fine) {
          parts.push(
            ...(await storage.readPatternBuckets({
              runner: tx,
              streamId: input.streamId,
              from: fine.from,
              to: fine.to,
              grain: "minute",
            })),
          );
        }
        return sumPatternPointsByHour(parts);
      });
      return { grain: "hour", points };
    },

    async listPatterns({ streamId, limit, includeHidden, bands, orderBy }) {
      const conditions = [eq(logPatterns.streamId, streamId)];
      // Hidden patterns leave every default listing (pickers, top patterns);
      // only the Patterns tab's management view opts back in to unhide them.
      if (!includeHidden) conditions.push(eq(logPatterns.hidden, false));
      if (bands && bands.length > 0) {
        // Derive the band in SQL exactly as `bandFromSeverityNumber` does
        // (including the out-of-range -> 'info' default), so the filter can
        // never disagree with the DTO's displayed band.
        conditions.push(
          inArray(
            sql`
              case
                            when ${logPatterns.severityMax} between 1 and 4 then 'trace'
                            when ${logPatterns.severityMax} between 5 and 8 then 'debug'
                            when ${logPatterns.severityMax} between 13 and 16 then 'warn'
                            when ${logPatterns.severityMax} between 17 and 20 then 'error'
                            when ${logPatterns.severityMax} between 21 and 24 then 'fatal'
                            else 'info' end
            `,
            bands,
          ),
        );
      }
      const rows = await db
        .select()
        .from(logPatterns)
        .where(and(...conditions))
        // `totalCount`: pure volume ordering (the "Top patterns" card).
        // `lastSeenAt` (default): user-authored patterns first, then recency. A
        // stream can hold up to MAX_USER_PATTERNS_PER_STREAM protected user
        // patterns; ordering by lastSeenAt alone would sink a quiet-but-
        // important user pattern below the `limit`-capped page of chatty mined
        // ones, hiding it from the picker.
        .orderBy(
          ...(orderBy === "totalCount"
            ? [desc(logPatterns.totalCount)]
            : [
                sql`case when ${logPatterns.origin} = 'user' then 0 else 1 end`,
                desc(logPatterns.lastSeenAt),
              ]),
        )
        .limit(limit);
      return rows.map((row) => mapPatternRow(row));
    },

    // Custom-pattern operations (create / delete / test / list variables) live
    // in ./patterns to keep this file lean; RLAC is enforced by the contract.
    createPattern: patternOps.createPattern,
    deletePattern: patternOps.deletePattern,
    setPatternHidden: patternOps.setPatternHidden,
    testPattern: patternOps.testPattern,
    maskLine: patternOps.maskLine,
    listPatternVariables: patternOps.listPatternVariables,

    // System links (explicit stream -> catalog-system mapping); RLAC is enforced
    // by the contract. The "cannot expose what you cannot see" readability gate
    // over the ADDED subset lives in the router's injected authorizer.
    listSystemLinks: systemLinkOps.listSystemLinks,
    getSystemLinksForUpdate: systemLinkOps.getSystemLinksForUpdate,
    setSystemLinks: systemLinkOps.setSystemLinks,
    listStreamsForSystem: systemLinkOps.listStreamsForSystem,
    listLinkedStreamStatuses: systemLinkOps.listLinkedStreamStatuses,
    listServiceNames: systemLinkOps.listServiceNames,

    async listImportantEvents({ streamId, cursor, limit }) {
      const conditions = [eq(logImportantEvents.streamId, streamId)];
      if (cursor) {
        // Tuple keyset over the (ts DESC, id DESC) order: strictly BEFORE the
        // cursor row. `ts` alone would skip or repeat rows sharing a millisecond
        // (throttle/pattern events burst at the same ts), so the id breaks the tie.
        conditions.push(
          or(
            lt(logImportantEvents.ts, cursor.ts),
            and(
              eq(logImportantEvents.ts, cursor.ts),
              lt(logImportantEvents.id, cursor.id),
            ),
          )!,
        );
      }
      // Fetch one extra to compute the next cursor without a second query.
      const rows = await db
        .select()
        .from(logImportantEvents)
        .where(and(...conditions))
        .orderBy(desc(logImportantEvents.ts), desc(logImportantEvents.id))
        .limit(limit + 1);
      const events = rows.slice(0, limit).map((row) => mapImportantEventRow(row));
      const last = events.at(-1);
      const nextCursor =
        rows.length > limit && last ? { ts: last.ts, id: last.id } : null;
      return { events, nextCursor };
    },

    async getStreamOverview({ streamId }) {
      const stream = await getStreamRowOrThrow(streamId);
      const to = now();
      const from = new Date(to.getTime() - 24 * 3_600_000);
      const [activity, last24hSeverityTotals, topPatternRows] =
        await Promise.all([
          storage.readStreamActivity({ runner: db, streamId }),
          sumSeverityMerged({
            streamId,
            from,
            to,
            minuteRetentionHours: stream.config.minuteRetentionHours,
          }),
          db
            .select()
            .from(logPatterns)
            .where(
              and(
                eq(logPatterns.streamId, streamId),
                // Hidden patterns are exactly what the user pushed out of the
                // Top patterns card.
                eq(logPatterns.hidden, false),
              ),
            )
            .orderBy(desc(logPatterns.totalCount))
            .limit(OVERVIEW_TOP_PATTERNS),
        ]);
      return {
        stream: mapStreamRow(stream),
        activity,
        counters: ingestCounters?.(streamId) ?? null,
        last24hSeverityTotals,
        topPatterns: topPatternRows.map((row) => mapPatternRow(row)),
      };
    },
  };
}

// =============================================================================
// PURE HELPERS (unit-tested in service.test.ts)
// =============================================================================

/**
 * Escape LIKE/ILIKE metacharacters so a search term is matched literally
 * (Postgres uses `\` as the default ILIKE escape). Prevents a user's `%` / `_`
 * from turning into a wildcard.
 */
export function escapeLikePattern(text: string): string {
  return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Assemble the streams-list summaries from the batched grouped reads. Pure so
 * the fold (zero-fill, cross-tier severity sum, pattern count join) is
 * unit-tested without a DB. `severity` is the CONCATENATION of the minute-tier
 * and hourly-tier grouped rows; each `total` is summed per `(streamId, band)`,
 * so the two tiers add up for the same 24h window. Every stream in `streamIds`
 * yields exactly one summary (missing aggregates zero-fill).
 */
export function assembleStreamSummaries({
  streamIds,
  activity,
  severity,
  patternCounts,
}: {
  streamIds: string[];
  activity: Array<{ streamId: string; lastReceivedAt: Date | null }>;
  severity: Array<{ streamId: string; band: SeverityBand; total: string | number }>;
  patternCounts: Array<{ streamId: string; count: string | number }>;
}): LogStreamSummary[] {
  const lastReceivedByStream = new Map(
    activity.map((a) => [a.streamId, a.lastReceivedAt]),
  );
  const patternCountByStream = new Map(
    patternCounts.map((p) => [p.streamId, Number(p.count)]),
  );
  const errorByStream = new Map<string, number>();
  const warnByStream = new Map<string, number>();
  for (const row of severity) {
    const target = row.band === "error" ? errorByStream : warnByStream;
    target.set(row.streamId, (target.get(row.streamId) ?? 0) + Number(row.total));
  }
  return streamIds.map((id) => ({
    id,
    lastReceivedAt: lastReceivedByStream.get(id) ?? null,
    last24hErrorCount: errorByStream.get(id) ?? 0,
    last24hWarnCount: warnByStream.get(id) ?? 0,
    patternCount: patternCountByStream.get(id) ?? 0,
  }));
}

/**
 * The keyset cursor to return for the next (older) page: the last row's
 * `(ts, id)` when the page was full, else `null` (no more rows).
 */
export function nextCursorFor(
  events: LogEvent[],
  limit: number,
): EventCursor | null {
  if (events.length < limit) return null;
  const last = events.at(-1)!;
  return { ts: last.ts, id: last.id };
}

// =============================================================================
// ROW MAPPERS
// =============================================================================

function mapStreamRow(row: typeof logStreams.$inferSelect): LogStream {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPatternRow(row: typeof logPatterns.$inferSelect): LogPattern {
  return {
    id: row.id,
    streamId: row.streamId,
    template: row.template,
    tokenCount: row.tokenCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sampleBody: row.sampleBody,
    totalCount: Number(row.totalCount),
    severityMax: row.severityMax,
    band: bandFromSeverityNumber(row.severityMax),
    origin: row.origin,
    hidden: row.hidden,
  };
}

function mapEventRow(row: typeof logEvents.$inferSelect): LogEvent {
  return {
    id: String(row.id),
    streamId: row.streamId,
    ts: row.ts,
    observedAt: row.observedAt,
    severityNumber: row.severityNumber,
    severityText: row.severityText,
    band: row.band,
    body: row.body,
    attributes: row.attributes,
    resource: row.resource,
    patternId: row.patternId,
    traceId: row.traceId,
    spanId: row.spanId,
  };
}

function mapImportantEventRow(
  row: typeof logImportantEvents.$inferSelect,
): ImportantEvent {
  return {
    id: row.id,
    streamId: row.streamId,
    ts: row.ts,
    type: row.type,
    severityNumber: row.severityNumber,
    patternId: row.patternId,
    title: row.title,
    detail: row.detail,
    createdAt: row.createdAt,
  };
}

/**
 * Delete the ReBAC team grants for a removed stream via auth's
 * `deleteObjectRelations`, keyed on the SAME qualified type the access rule
 * grants on (`logstream.stream`). Best-effort: the stream's own DB rows are
 * already deleted, so an auth-RPC failure is logged rather than rethrown (it
 * would surface an error for an operation that otherwise succeeded). When no
 * `rpcClient` is wired, grant cleanup is skipped with a warning.
 */
async function deleteStreamGrants({
  rpcClient,
  streamId,
  logger,
}: {
  rpcClient?: RpcClient;
  streamId: string;
  logger: Logger;
}): Promise<void> {
  if (!rpcClient) {
    logger.warn(
      "logstream: rpcClient not provided; skipped team-grant cleanup for deleted stream (grants may orphan).",
    );
    return;
  }
  try {
    await rpcClient.forPlugin(AuthApi).deleteObjectRelations({
      objectType: logstreamResourceTypes.stream,
      objectId: streamId,
    });
  } catch (error) {
    logger.warn(
      `logstream: failed to delete team grants for stream ${streamId}: ${String(error)}`,
    );
  }
}

/**
 * Cascade a stream deletion to the telemetry platform via
 * `handleStreamDeleted`, so every source binding this stream is stripped and
 * sources left binding-less are fully deleted. Best-effort and idempotent: the
 * stream's own deletion already succeeded, so a lifecycle failure is logged
 * rather than rethrown (it would surface an error for an operation that
 * otherwise completed). When no `sourceLifecycle` is wired, the cascade is
 * skipped with a warning.
 */
async function cascadeSourceDeletion({
  sourceLifecycle,
  signal,
  streamId,
  logger,
}: {
  sourceLifecycle?: TelemetrySourceLifecycle;
  signal: "logs";
  streamId: string;
  logger: Logger;
}): Promise<void> {
  if (!sourceLifecycle) {
    logger.warn(
      "logstream: telemetry source lifecycle not provided; skipped source cascade for deleted stream (bindings may orphan).",
    );
    return;
  }
  try {
    await sourceLifecycle.handleStreamDeleted({ signal, streamId });
  } catch (error) {
    logger.warn(
      `logstream: failed to cascade telemetry source deletion for stream ${streamId}: ${String(error)}`,
    );
  }
}
