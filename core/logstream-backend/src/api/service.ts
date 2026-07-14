import { ORPCError } from "@orpc/server";
import { and, or, eq, ilike, inArray, lt, gte, lte, desc, sql } from "drizzle-orm";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
  EventBus,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import { AuthApi } from "@checkstack/auth-common";
import {
  LogStreamConfigSchema,
  bandFromSeverityNumber,
  logstreamResourceTypes,
  type LogStream,
  type CreateLogStream,
  type UpdateLogStream,
  type LogStreamToken,
  type MintTokenResult,
  type SearchEvents,
  type SearchEventsResult,
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
import { generateToken } from "../token-crypto";
import {
  createPatternOperations,
  type PatternOperations,
} from "./patterns";
import type { FindReferencingChecks } from "../health/pattern-references";
import * as schema from "../schema";
import {
  logstreamTokensInvalidatedHook,
  type LogstreamTokensInvalidatedPayload,
} from "../events/bus-hooks";
import {
  logStreams,
  logStreamTokens,
  logEvents,
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
  logImportantEvents,
  logStreamActivity,
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
import { createIngestTokenCache, ingestTokenCacheKey } from "./token-cache";
// The negative (unknown-token) miss-marker key convention is owned by the
// ingest auth path; the mint path invalidates the SAME shared key so a
// just-minted token is not shadowed by a stale negative entry. Approved
// cross-area import (both are the logstream plugin), mirroring how ingest/auth
// imports the positive-key builder from api/token-cache.
import { ingestTokenMissKey } from "../ingest/auth";
import type { CachedScope } from "@checkstack/cache-utils";

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

  listTokens(input: { streamId: string }): Promise<LogStreamToken[]>;
  mintToken(input: { streamId: string; name: string }): Promise<MintTokenResult>;
  revokeToken(input: { streamId: string; tokenId: string }): Promise<void>;

  searchEvents(input: SearchEvents): Promise<SearchEventsResult>;
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
}

export function createLogstreamService({
  db,
  storage,
  cacheManager,
  logger,
  rpcClient,
  eventBus,
  ingestCounters,
  findReferencingChecks,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  cacheManager: CacheManager;
  logger: Logger;
  /**
   * Platform RPC client, used to clean up the deleted stream's team grants via
   * auth's `deleteObjectRelations`. Optional so lightweight tests can omit it;
   * when absent, `deleteStream` logs a warning and skips grant cleanup (the DB
   * cascade still runs).
   */
  rpcClient?: RpcClient;
  /**
   * Platform event bus, used to broadcast `logstream.tokens.invalidated`
   * after token mutations so every pod can evict POD-LOCAL token state the
   * shared-cache invalidation cannot reach (syslog per-connection verdicts,
   * the negative unknown-token cache). Optional so lightweight tests can omit
   * it; the pod-local TTLs remain the backstop when absent.
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
  const tokenCache: CachedScope = createIngestTokenCache({ cacheManager });

  const patternOps: PatternOperations = createPatternOperations({
    db,
    eventBus,
    logger,
    findReferencingChecks: findReferencingChecks ?? (async () => []),
    now,
  });

  /**
   * Best-effort post-commit broadcast of a token lifecycle change. Never
   * throws: the DB is the source of truth and the pod-local TTLs bound the
   * staleness window if the bus is unavailable.
   */
  async function emitTokensInvalidated(
    payload: LogstreamTokensInvalidatedPayload,
  ): Promise<void> {
    if (!eventBus) return;
    try {
      await eventBus.emit(logstreamTokensInvalidatedHook, payload);
    } catch (error) {
      logger.warn(
        `logstream: failed to broadcast token invalidation (${payload.reason}): ${String(error)}`,
      );
    }
  }

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
      // tables (bounded by retention) go in a single statement each. Token
      // hashes are captured first so their ingest-auth cache entries can be
      // invalidated after commit.
      const tokenRows = await withScopedTransaction(db, async (tx) => {
        const rows = await tx
          .select({
            tokenId: logStreamTokens.id,
            tokenHash: logStreamTokens.tokenHash,
          })
          .from(logStreamTokens)
          .where(eq(logStreamTokens.streamId, id));

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
          .delete(logStreamTokens)
          .where(eq(logStreamTokens.streamId, id));
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
        await tx.delete(logStreams).where(eq(logStreams.id, id));

        return rows;
      });

      // After commit: drop each token's cached ingest-auth verdict (shared
      // cache, reaches every pod's HTTP path immediately) and broadcast so
      // pods also evict POD-LOCAL state (open syslog connection verdicts).
      await invalidateTokenCaches({
        tokenCache,
        tokenHashes: tokenRows.map((r) => r.tokenHash),
        logger,
      });
      await emitTokensInvalidated({
        streamId: id,
        reason: "stream_deleted",
        tokenIds: tokenRows.map((r) => r.tokenId),
        tokenHashes: tokenRows.map((r) => r.tokenHash),
      });

      // Also clear the stream's ReBAC team grants so they don't orphan (the
      // stream row is gone; a grant to `logstream.stream:<id>` would dangle in
      // the relation-tuple store). Best-effort: the DB cascade already
      // committed, so an auth-RPC failure is logged, not rethrown.
      await deleteStreamGrants({ rpcClient, streamId: id, logger });
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

    async listTokens({ streamId }) {
      const rows = await db
        .select()
        .from(logStreamTokens)
        .where(eq(logStreamTokens.streamId, streamId))
        .orderBy(desc(logStreamTokens.createdAt));
      // NEVER expose `tokenHash` - only the display prefix survives the mapping.
      return rows.map((row) => mapTokenRow(row));
    },

    async mintToken({ streamId, name }) {
      await getStreamRowOrThrow(streamId);
      const generated = generateToken({ streamId });
      const id = crypto.randomUUID();
      const createdAt = now();
      const [row] = await db
        .insert(logStreamTokens)
        .values({
          id,
          streamId,
          name,
          tokenHash: generated.tokenHash,
          tokenPrefix: generated.tokenPrefix,
          createdAt,
          lastUsedAt: null,
          revokedAt: null,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to mint token",
        });
      }
      // Clear any shared negative (unknown-token) miss marker for this hash so
      // the freshly-minted token authenticates immediately instead of being
      // shadowed by a stale miss for up to its TTL. Best-effort: a cache error
      // must never fail the mint (the DB row is the source of truth).
      try {
        await tokenCache.invalidate(ingestTokenMissKey(generated.tokenHash));
      } catch (error) {
        logger.warn(
          `logstream: failed to clear ingest-token miss marker on mint: ${String(error)}`,
        );
      }
      // Broadcast so every pod also clears its IN-PROCESS negative cache for
      // this hash (the shared miss marker above cannot reach those), letting
      // the fresh token authenticate immediately instead of after the
      // negative-cache TTL.
      await emitTokensInvalidated({
        streamId,
        reason: "minted",
        tokenIds: [id],
        tokenHashes: [generated.tokenHash],
      });

      // The full secret is returned ONCE here and never persisted or logged.
      return { secret: generated.secret, token: mapTokenRow(row) };
    },

    async revokeToken({ streamId, tokenId }) {
      // Scoped to BOTH the token id AND its parent streamId so a manager of
      // `streamId` cannot revoke a token belonging to another stream (the
      // instanceAccess check only proved manage on `streamId`).
      const [row] = await db
        .update(logStreamTokens)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(logStreamTokens.id, tokenId),
            eq(logStreamTokens.streamId, streamId),
          ),
        )
        .returning({ tokenHash: logStreamTokens.tokenHash });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Token not found" });
      }
      await invalidateTokenCaches({
        tokenCache,
        tokenHashes: [row.tokenHash],
        logger,
      });
      // Broadcast so an already-open syslog connection on any pod drops its
      // cached verdict for this token immediately instead of after the 60s
      // per-connection TTL.
      await emitTokensInvalidated({
        streamId,
        reason: "revoked",
        tokenIds: [tokenId],
        tokenHashes: [row.tokenHash],
      });
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

    async listImportantEvents({ streamId, before, limit }) {
      const conditions = [eq(logImportantEvents.streamId, streamId)];
      if (before) conditions.push(lt(logImportantEvents.ts, before));
      const rows = await db
        .select()
        .from(logImportantEvents)
        .where(and(...conditions))
        .orderBy(desc(logImportantEvents.ts))
        .limit(limit);
      const events = rows.map((row) => mapImportantEventRow(row));
      const nextBefore =
        events.length < limit ? null : events.at(-1)!.ts;
      return { events, nextBefore };
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

function mapTokenRow(row: typeof logStreamTokens.$inferSelect): LogStreamToken {
  return {
    id: row.id,
    streamId: row.streamId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
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
 * Invalidate the ingest-auth cache entry for each token hash. Best-effort: a
 * cache miss/error must never fail the mutation (the DB write is already the
 * source of truth), so failures are swallowed + logged.
 */
async function invalidateTokenCaches({
  tokenCache,
  tokenHashes,
  logger,
}: {
  tokenCache: CachedScope;
  tokenHashes: string[];
  logger: Logger;
}): Promise<void> {
  await Promise.all(
    tokenHashes.map(async (hash) => {
      try {
        await tokenCache.invalidate(ingestTokenCacheKey(hash));
      } catch (error) {
        logger.warn(
          `logstream: failed to invalidate ingest-token cache: ${String(error)}`,
        );
      }
    }),
  );
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
