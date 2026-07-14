import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
  EventBus,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import type {
  SourceTokenKit,
  IngestAuthenticator,
} from "@checkstack/ingest-utils";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { isSecretReference } from "@checkstack/secrets-common";
import { AuthApi } from "@checkstack/auth-common";
import {
  MetricStreamConfigSchema,
  metricstreamResourceTypes,
  type MetricStream,
  type CreateMetricStream,
  type UpdateMetricStream,
  type MetricStreamToken,
  type MintTokenResult,
  type MetricScrapeTarget,
  type CreateScrapeTarget,
  type UpdateScrapeTarget,
  type MetricStreamSummary,
  type StreamForPicker,
  type MetricNameInfo,
  type MetricSeriesInfo,
  type ListMetricNames,
  type ListLabelKeys,
  type ListLabelValues,
  type ListMetricSeries,
  type GetMetricBuckets,
  type GetMetricBucketsResult,
  type ListImportantEvents,
  type ListImportantEventsResult,
  type ImportantEvent,
  type StreamOverview,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import {
  metricStreams,
  metricStreamTokens,
  metricScrapeTargets,
  metricNames,
  metricSeries,
  metricMinuteBuckets,
  metricHourlyBuckets,
  metricImportantEvents,
  metricStreamActivity,
} from "../schema";
import type { Storage } from "../storage";
import {
  chunk,
  STORAGE_CHUNK_SIZE,
  listMetricNames as listMetricNamesStorage,
} from "../storage";
import {
  storeScrapeTargetBearer,
  clearScrapeTargetBearer,
} from "../secrets/scrape-target-secret";
import {
  createIngestTokenCache,
  ingestTokenCacheKey,
} from "./token-cache";
import {
  resolveGrain,
  rollupBoundary,
  partitionWindowAtBoundary,
  foldMetricPointsByHour,
  mergeMetricPoints,
  readBucketPoints,
} from "./buckets-merge";
import {
  metricstreamTokensInvalidatedHook,
  type MetricstreamTokensInvalidatedPayload,
} from "../events/bus-hooks";

/** How many stream-scoped rows to delete per batch in the deleteStream cascade. */
const CASCADE_BATCH = 5000;
/** Max concrete series a chart/aggregate selection resolves (label cardinality bound). */
const MAX_SELECTED_SERIES = 20_000;
/** Top metric names surfaced on the overview page. */
const OVERVIEW_TOP_METRICS = 5;

/**
 * Post-commit hook the API calls after any scrape-target mutation so the C1
 * scrape reconciler can (re)schedule / cancel the recurring scrape job for the
 * stream. SEAM: wired by `index.ts` once C1 exports the reconciler; absent =>
 * no-op (the target row is persisted regardless, and the reconciler re-derives
 * schedules from the table on its next tick).
 */
export type OnScrapeTargetsChanged = (input: {
  streamId: string;
  targetId: string;
  /** `upserted` after create/update; `removed` after a delete. */
  action: "upserted" | "removed";
  /**
   * Satellite bindings affected by this mutation (deduped, non-null). On a
   * rebind this is BOTH the old and the new satellite so each converges its
   * scrape set; empty when the target is purely core-scheduled. The wiring in
   * index.ts fires `notifyCapabilityConfigChanged({ kind: "metric-scrape",
   * satelliteId })` for each id.
   */
  satelliteIds?: string[];
}) => void | Promise<void>;

export interface MetricstreamService {
  createStream(input: CreateMetricStream): Promise<MetricStream>;
  updateStream(input: { id: string; body: UpdateMetricStream }): Promise<MetricStream>;
  deleteStream(input: { id: string }): Promise<void>;
  listStreams(): Promise<{ streams: MetricStream[] }>;
  listStreamSummaries(): Promise<{ summaries: MetricStreamSummary[] }>;
  getStream(input: { id: string }): Promise<MetricStream>;
  listStreamsForPicker(): Promise<StreamForPicker[]>;

  listTokens(input: { streamId: string }): Promise<MetricStreamToken[]>;
  mintToken(input: { streamId: string; name: string }): Promise<MintTokenResult>;
  revokeToken(input: { streamId: string; tokenId: string }): Promise<void>;

  listScrapeTargets(input: { streamId: string }): Promise<MetricScrapeTarget[]>;
  createScrapeTarget(input: CreateScrapeTarget): Promise<MetricScrapeTarget>;
  updateScrapeTarget(input: UpdateScrapeTarget): Promise<MetricScrapeTarget>;
  deleteScrapeTarget(input: { streamId: string; targetId: string }): Promise<void>;

  listMetricNames(input: ListMetricNames): Promise<{ names: MetricNameInfo[] }>;
  listLabelKeys(input: ListLabelKeys): Promise<{ keys: string[] }>;
  listLabelValues(input: ListLabelValues): Promise<{ values: string[] }>;
  listMetricSeries(input: ListMetricSeries): Promise<{ series: MetricSeriesInfo[] }>;
  getMetricBuckets(input: GetMetricBuckets): Promise<GetMetricBucketsResult>;
  listImportantEvents(input: ListImportantEvents): Promise<ListImportantEventsResult>;
  getStreamOverview(input: { streamId: string }): Promise<StreamOverview>;
}

export function createMetricstreamService({
  db,
  storage,
  cacheManager,
  logger,
  tokenKit,
  auth,
  internalSecrets,
  rpcClient,
  eventBus,
  onScrapeTargetsChanged,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  cacheManager: CacheManager;
  logger: Logger;
  /** ckms_ token kit (mint + hash). */
  tokenKit: SourceTokenKit;
  /** Ingest authenticator - used to clear negative caches on mint. */
  auth: IngestAuthenticator;
  /** Internal secret store for scrape-target bearer tokens. */
  internalSecrets: InternalSecretsService;
  /** Platform RPC client for auth grant cleanup on stream delete (optional). */
  rpcClient?: RpcClient;
  /** Platform event bus for cross-pod token-invalidation (optional). */
  eventBus?: EventBus;
  /** C1 scrape-reconciler post-commit hook (optional; SEAM). */
  onScrapeTargetsChanged?: OnScrapeTargetsChanged;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}): MetricstreamService {
  const tokenCache: CachedScope = createIngestTokenCache({ cacheManager });

  async function getStreamRowOrThrow(id: string) {
    const [row] = await db
      .select()
      .from(metricStreams)
      .where(eq(metricStreams.id, id))
      .limit(1);
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Metric stream not found" });
    }
    return row;
  }

  async function emitTokensInvalidated(
    payload: MetricstreamTokensInvalidatedPayload,
  ): Promise<void> {
    if (!eventBus) return;
    try {
      await eventBus.emit(metricstreamTokensInvalidatedHook, payload);
    } catch (error) {
      logger.warn(
        `metricstream: failed to broadcast token invalidation (${payload.reason}): ${String(error)}`,
      );
    }
  }

  async function notifyScrapeChanged(input: {
    streamId: string;
    targetId: string;
    action: "upserted" | "removed";
    satelliteIds?: string[];
  }): Promise<void> {
    if (!onScrapeTargetsChanged) return;
    try {
      await onScrapeTargetsChanged(input);
    } catch (error) {
      logger.warn(
        `metricstream: scrape-target reconcile hook failed for target ${input.targetId} (${input.action}): ${String(error)}`,
      );
    }
  }

  /** Resolve the series ids a `(metricName, labelFilters)` selection matches. */
  async function selectMatchingSeriesIds({
    streamId,
    metricName,
    labelFilters,
  }: {
    streamId: string;
    metricName: string;
    labelFilters?: { key: string; value: string }[];
  }): Promise<string[]> {
    const conditions = [
      eq(metricSeries.streamId, streamId),
      eq(metricSeries.name, metricName),
    ];
    if (labelFilters && labelFilters.length > 0) {
      const containment: Record<string, string> = {};
      for (const { key, value } of labelFilters) containment[key] = value;
      conditions.push(
        sql`${metricSeries.labels} @> ${JSON.stringify(containment)}::jsonb`,
      );
    }
    const rows = await db
      .select({ id: metricSeries.id })
      .from(metricSeries)
      .where(and(...conditions))
      .limit(MAX_SELECTED_SERIES);
    return rows.map((r) => r.id);
  }

  return {
    async createStream(input) {
      const config = MetricStreamConfigSchema.parse(input.config ?? {});
      const id = crypto.randomUUID();
      const [row] = await db
        .insert(metricStreams)
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          config,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create metric stream",
        });
      }
      return mapStreamRow(row);
    },

    async updateStream({ id, body }) {
      const existing = await getStreamRowOrThrow(id);
      const nextConfig = body.config
        ? MetricStreamConfigSchema.parse({ ...existing.config, ...body.config })
        : existing.config;
      const [row] = await db
        .update(metricStreams)
        .set({
          name: body.name ?? existing.name,
          description:
            body.description === undefined
              ? existing.description
              : body.description,
          config: nextConfig,
          updatedAt: now(),
        })
        .where(eq(metricStreams.id, id))
        .returning();
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Metric stream not found" });
      }
      return mapStreamRow(row);
    },

    async deleteStream({ id }) {
      // Explicit cascade (no FKs): every stream-scoped table is cleared by hand
      // in ONE transaction. Buckets key on seriesId, so they are deleted by the
      // stream's series ids (batched). Token hashes + scrape-target ids are
      // captured first so their caches / internal secrets can be cleaned after
      // commit.
      const { tokenRows, scrapeTargets } = await withScopedTransaction(
        db,
        async (tx) => {
          const tokens = await tx
            .select({
              tokenId: metricStreamTokens.id,
              tokenHash: metricStreamTokens.tokenHash,
            })
            .from(metricStreamTokens)
            .where(eq(metricStreamTokens.streamId, id));
          const targets = await tx
            .select({
              id: metricScrapeTargets.id,
              satelliteId: metricScrapeTargets.satelliteId,
            })
            .from(metricScrapeTargets)
            .where(eq(metricScrapeTargets.streamId, id));

          // Delete buckets for this stream's series in bounded batches, then the
          // series rows themselves.
          for (;;) {
            const batch = await tx
              .select({ id: metricSeries.id })
              .from(metricSeries)
              .where(eq(metricSeries.streamId, id))
              .limit(CASCADE_BATCH);
            if (batch.length === 0) break;
            const ids = batch.map((r) => r.id);
            for (const part of chunk({ items: ids, size: STORAGE_CHUNK_SIZE })) {
              await tx
                .delete(metricMinuteBuckets)
                .where(inArray(metricMinuteBuckets.seriesId, part));
              await tx
                .delete(metricHourlyBuckets)
                .where(inArray(metricHourlyBuckets.seriesId, part));
            }
            await tx.delete(metricSeries).where(inArray(metricSeries.id, ids));
            if (batch.length < CASCADE_BATCH) break;
          }

          await tx
            .delete(metricNames)
            .where(eq(metricNames.streamId, id));
          await tx
            .delete(metricStreamTokens)
            .where(eq(metricStreamTokens.streamId, id));
          await tx
            .delete(metricScrapeTargets)
            .where(eq(metricScrapeTargets.streamId, id));
          await tx
            .delete(metricImportantEvents)
            .where(eq(metricImportantEvents.streamId, id));
          await tx
            .delete(metricStreamActivity)
            .where(eq(metricStreamActivity.streamId, id));
          await tx.delete(metricStreams).where(eq(metricStreams.id, id));

          return { tokenRows: tokens, scrapeTargets: targets };
        },
      );

      // After commit: drop each token's cached ingest-auth verdict (shared cache,
      // reaches every pod's HTTP path immediately) and broadcast so pods evict
      // per-pod negative caches too.
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

      // Clear each scrape target's internal bearer secret (best-effort).
      await Promise.all(
        scrapeTargets.map(async ({ id: targetId }) => {
          try {
            await clearScrapeTargetBearer({ internalSecrets, targetId });
          } catch (error) {
            logger.warn(
              `metricstream: failed to clear scrape-target secret ${targetId} on stream delete: ${String(error)}`,
            );
          }
        }),
      );

      // Clean up the stream's ReBAC team grants, and let the reconciler cancel
      // any scheduled scrape jobs for the (now gone) targets. Satellite-bound
      // targets additionally notify their satellite so it drops them. All
      // best-effort.
      await deleteStreamGrants({ rpcClient, streamId: id, logger });
      for (const { id: targetId, satelliteId } of scrapeTargets) {
        await notifyScrapeChanged({
          streamId: id,
          targetId,
          action: "removed",
          satelliteIds: satelliteId ? [satelliteId] : [],
        });
      }
    },

    async listStreams() {
      const rows = await db.select().from(metricStreams);
      return { streams: rows.map((row) => mapStreamRow(row)) };
    },

    async listStreamSummaries() {
      // ONE set-based batch: base on every stream, then LEFT-fold the activity
      // row and the distinct series count. `listKey` filters by each summary's
      // `id` (the stream id) to the caller's readable set.
      const summaries = await withScopedTransaction(db, async (tx) => {
        // SEQUENTIAL on purpose: the three queries share this transaction's ONE
        // pg client, and pg serializes (and deprecates, removing in pg@9)
        // concurrent client.query() calls. Parallelize only across POOL
        // clients (standalone scoped queries), never within a tx.
        const streamRows = await tx
          .select({ id: metricStreams.id, config: metricStreams.config })
          .from(metricStreams);
        const activityRows = await tx
          .select({
            streamId: metricStreamActivity.streamId,
            lastReceivedAt: metricStreamActivity.lastReceivedAt,
            approxDatapointsPerMinute:
              metricStreamActivity.approxDatapointsPerMinute,
            droppedSeriesCount: metricStreamActivity.droppedSeriesCount,
          })
          .from(metricStreamActivity);
        const seriesCountRows = await tx
          .select({
            streamId: metricSeries.streamId,
            count: sql<string>`count(*)`,
          })
          .from(metricSeries)
          .groupBy(metricSeries.streamId);
        const activityByStream = new Map(
          activityRows.map((a) => [a.streamId, a]),
        );
        const seriesCountByStream = new Map(
          seriesCountRows.map((r) => [r.streamId, Number(r.count)]),
        );
        return streamRows.map((s): MetricStreamSummary => {
          const activity = activityByStream.get(s.id);
          const config = MetricStreamConfigSchema.parse(s.config ?? {});
          return {
            id: s.id,
            lastReceivedAt: activity?.lastReceivedAt ?? null,
            approxDatapointsPerMinute: Number(
              activity?.approxDatapointsPerMinute ?? 0,
            ),
            seriesCount: seriesCountByStream.get(s.id) ?? 0,
            seriesCap: config.seriesCap,
            droppedSeriesCount: Number(activity?.droppedSeriesCount ?? 0),
          };
        });
      });
      return { summaries };
    },

    async getStream({ id }) {
      return mapStreamRow(await getStreamRowOrThrow(id));
    },

    async listStreamsForPicker() {
      const rows = await db
        .select({ id: metricStreams.id, name: metricStreams.name })
        .from(metricStreams)
        .orderBy(metricStreams.name);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },

    async listTokens({ streamId }) {
      const rows = await db
        .select()
        .from(metricStreamTokens)
        .where(eq(metricStreamTokens.streamId, streamId))
        .orderBy(desc(metricStreamTokens.createdAt));
      return rows.map((row) => mapTokenRow(row));
    },

    async mintToken({ streamId, name }) {
      await getStreamRowOrThrow(streamId);
      const generated = tokenKit.generateToken({ resourceId: streamId });
      const id = crypto.randomUUID();
      const createdAt = now();
      const [row] = await db
        .insert(metricStreamTokens)
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
      // Clear this pod's negative (unknown-token) cache + the shared miss marker
      // so the freshly-minted token authenticates immediately instead of being
      // shadowed by a stale miss for up to its TTL. Best-effort.
      try {
        await auth.clearNegative?.(generated.tokenHash);
      } catch (error) {
        logger.warn(
          `metricstream: failed to clear ingest-token miss marker on mint: ${String(error)}`,
        );
      }
      // Broadcast so every OTHER pod clears its in-process negative cache too.
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
      // Scoped to BOTH id AND streamId so a manager of `streamId` cannot revoke
      // a token belonging to another stream.
      const [row] = await db
        .update(metricStreamTokens)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(metricStreamTokens.id, tokenId),
            eq(metricStreamTokens.streamId, streamId),
          ),
        )
        .returning({ tokenHash: metricStreamTokens.tokenHash });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Token not found" });
      }
      await invalidateTokenCaches({
        tokenCache,
        tokenHashes: [row.tokenHash],
        logger,
      });
      await emitTokensInvalidated({
        streamId,
        reason: "revoked",
        tokenIds: [tokenId],
        tokenHashes: [row.tokenHash],
      });
    },

    async listScrapeTargets({ streamId }) {
      const rows = await db
        .select()
        .from(metricScrapeTargets)
        .where(eq(metricScrapeTargets.streamId, streamId))
        .orderBy(desc(metricScrapeTargets.createdAt));
      return rows.map((row) => mapScrapeTargetRow(row));
    },

    async createScrapeTarget(input) {
      await getStreamRowOrThrow(input.streamId);
      const id = crypto.randomUUID();
      const bearerTokenSecret = await persistBearer({
        internalSecrets,
        targetId: id,
        value: input.bearerToken,
      });
      const satelliteId = input.satelliteId ?? null;
      const [row] = await db
        .insert(metricScrapeTargets)
        .values({
          id,
          streamId: input.streamId,
          name: input.name,
          url: input.url,
          intervalSeconds: input.intervalSeconds,
          timeoutMs: input.timeoutMs,
          bearerTokenSecret,
          satelliteId,
          enabled: input.enabled,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create scrape target",
        });
      }
      await notifyScrapeChanged({
        streamId: input.streamId,
        targetId: row.id,
        action: "upserted",
        satelliteIds: satelliteId ? [satelliteId] : [],
      });
      return mapScrapeTargetRow(row);
    },

    async updateScrapeTarget(input) {
      const [existing] = await db
        .select()
        .from(metricScrapeTargets)
        .where(
          and(
            eq(metricScrapeTargets.id, input.targetId),
            eq(metricScrapeTargets.streamId, input.streamId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Scrape target not found" });
      }

      // bearerToken sentinel: undefined = keep, null = clear, string = set.
      let bearerTokenSecret = existing.bearerTokenSecret;
      if (input.bearerToken === null) {
        await clearScrapeTargetBearer({ internalSecrets, targetId: input.targetId });
        bearerTokenSecret = null;
      } else if (typeof input.bearerToken === "string") {
        bearerTokenSecret = await persistBearer({
          internalSecrets,
          targetId: input.targetId,
          value: input.bearerToken,
        });
      }

      // satelliteId sentinel: undefined = keep, null = unbind (core), string =
      // (re)bind. Capture old + new so BOTH satellites are notified on a rebind.
      const nextSatelliteId =
        input.satelliteId === undefined
          ? existing.satelliteId
          : input.satelliteId;

      const [row] = await db
        .update(metricScrapeTargets)
        .set({
          name: input.name ?? existing.name,
          url: input.url ?? existing.url,
          intervalSeconds: input.intervalSeconds ?? existing.intervalSeconds,
          timeoutMs: input.timeoutMs ?? existing.timeoutMs,
          bearerTokenSecret,
          satelliteId: nextSatelliteId,
          enabled: input.enabled ?? existing.enabled,
          updatedAt: now(),
        })
        .where(eq(metricScrapeTargets.id, input.targetId))
        .returning();
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Scrape target not found" });
      }
      const affectedSatellites = [
        ...new Set(
          [existing.satelliteId, nextSatelliteId].filter(
            (id): id is string => id !== null,
          ),
        ),
      ];
      await notifyScrapeChanged({
        streamId: input.streamId,
        targetId: input.targetId,
        action: "upserted",
        satelliteIds: affectedSatellites,
      });
      return mapScrapeTargetRow(row);
    },

    async deleteScrapeTarget({ streamId, targetId }) {
      const [row] = await db
        .delete(metricScrapeTargets)
        .where(
          and(
            eq(metricScrapeTargets.id, targetId),
            eq(metricScrapeTargets.streamId, streamId),
          ),
        )
        .returning({
          id: metricScrapeTargets.id,
          satelliteId: metricScrapeTargets.satelliteId,
        });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Scrape target not found" });
      }
      try {
        await clearScrapeTargetBearer({ internalSecrets, targetId });
      } catch (error) {
        logger.warn(
          `metricstream: failed to clear scrape-target secret ${targetId} on delete: ${String(error)}`,
        );
      }
      await notifyScrapeChanged({
        streamId,
        targetId,
        action: "removed",
        satelliteIds: row.satelliteId ? [row.satelliteId] : [],
      });
    },

    async listMetricNames({ streamId, query, limit }) {
      const names = await listMetricNamesStorage({
        runner: db,
        streamId,
        query,
        limit,
      });
      return { names };
    },

    async listLabelKeys({ streamId, metricName, limit }) {
      const rows = await db
        .selectDistinct({
          key: sql<string>`jsonb_object_keys(${metricSeries.labels})`,
        })
        .from(metricSeries)
        .where(
          and(
            eq(metricSeries.streamId, streamId),
            eq(metricSeries.name, metricName),
          ),
        )
        // ORDER BY the DISTINCT output column by ordinal (Postgres requires the
        // sort key to appear in the SELECT DISTINCT list).
        .orderBy(sql`1`)
        .limit(limit);
      return { keys: rows.map((r) => r.key) };
    },

    async listLabelValues({ streamId, metricName, key, query, limit }) {
      const conditions = [
        eq(metricSeries.streamId, streamId),
        eq(metricSeries.name, metricName),
        sql`(${metricSeries.labels} ->> ${key}) is not null`,
      ];
      if (query) {
        conditions.push(
          sql`(${metricSeries.labels} ->> ${key}) ilike ${`%${escapeLikePattern(query)}%`}`,
        );
      }
      const rows = await db
        .selectDistinct({
          value: sql<string>`${metricSeries.labels} ->> ${key}`,
        })
        .from(metricSeries)
        .where(and(...conditions))
        .orderBy(sql`1`)
        .limit(limit);
      return { values: rows.map((r) => r.value) };
    },

    async listMetricSeries({ streamId, metricName, limit }) {
      const rows = await db
        .select()
        .from(metricSeries)
        .where(
          and(
            eq(metricSeries.streamId, streamId),
            eq(metricSeries.name, metricName),
          ),
        )
        .orderBy(desc(metricSeries.lastSeenAt))
        .limit(limit);
      return {
        series: rows.map((r) => ({
          id: r.id,
          name: r.name,
          labels: r.labels,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
        })),
      };
    },

    async getMetricBuckets(input) {
      const seriesIds = await selectMatchingSeriesIds({
        streamId: input.streamId,
        metricName: input.metricName,
        labelFilters: input.labelFilters,
      });
      const grain = resolveGrain({
        from: input.from,
        to: input.to,
        explicit: input.grain,
      });
      if (seriesIds.length === 0) return { grain, points: [] };

      if (grain === "minute") {
        const points = await readBucketPoints({
          runner: db,
          seriesIds,
          from: input.from,
          to: input.to,
          grain: "minute",
        });
        return { grain, points };
      }

      // Hour grain: coarse part from the hourly tier, recent fine part folded
      // from minute buckets not yet rolled up, then merged by hour.
      const stream = await getStreamRowOrThrow(input.streamId);
      const config = MetricStreamConfigSchema.parse(stream.config ?? {});
      const boundary = rollupBoundary({
        now: now(),
        minuteRetentionHours: config.minuteRetentionHours,
      });
      const { coarse, fine } = partitionWindowAtBoundary({
        from: input.from,
        to: input.to,
        boundary,
      });
      const points = await withScopedTransaction(db, async (tx) => {
        const coarsePoints = coarse
          ? await readBucketPoints({
              runner: tx,
              seriesIds,
              from: coarse.from,
              to: coarse.to,
              grain: "hour",
            })
          : [];
        const finePoints = fine
          ? foldMetricPointsByHour(
              await readBucketPoints({
                runner: tx,
                seriesIds,
                from: fine.from,
                to: fine.to,
                grain: "minute",
              }),
            )
          : [];
        return mergeMetricPoints(coarsePoints, finePoints);
      });
      return { grain: "hour", points };
    },

    async listImportantEvents({ streamId, cursor, limit }) {
      const conditions = [eq(metricImportantEvents.streamId, streamId)];
      if (cursor) {
        // Tuple keyset over the (ts DESC, id DESC) order: strictly BEFORE the
        // cursor row. `ts` alone would skip or repeat rows sharing a millisecond
        // (cap/rate events burst at the same ts), so the id breaks the tie.
        conditions.push(
          or(
            lt(metricImportantEvents.ts, cursor.ts),
            and(
              eq(metricImportantEvents.ts, cursor.ts),
              lt(metricImportantEvents.id, cursor.id),
            ),
          )!,
        );
      }
      // Fetch one extra to compute the next cursor without a second query.
      const rows = await db
        .select()
        .from(metricImportantEvents)
        .where(and(...conditions))
        .orderBy(desc(metricImportantEvents.ts), desc(metricImportantEvents.id))
        .limit(limit + 1);
      const events = rows.slice(0, limit).map((row) => mapImportantEventRow(row));
      const last = events.at(-1);
      const nextCursor =
        rows.length > limit && last ? { ts: last.ts, id: last.id } : null;
      return { events, nextCursor };
    },

    async getStreamOverview({ streamId }) {
      const stream = await getStreamRowOrThrow(streamId);
      const config = MetricStreamConfigSchema.parse(stream.config ?? {});
      const [activity, seriesCountRow, topMetrics] = await Promise.all([
        storage.readStreamActivity({ runner: db, streamId }),
        db
          .select({ count: sql<string>`count(*)` })
          .from(metricSeries)
          .where(eq(metricSeries.streamId, streamId)),
        db
          .select()
          .from(metricNames)
          .where(eq(metricNames.streamId, streamId))
          .orderBy(desc(metricNames.seriesCount))
          .limit(OVERVIEW_TOP_METRICS),
      ]);
      return {
        stream: mapStreamRow(stream),
        activity,
        seriesCount: Number(seriesCountRow[0]?.count ?? 0),
        seriesCap: config.seriesCap,
        topMetrics: topMetrics.map((r) => ({
          name: r.name,
          type: r.type,
          counterKind: r.counterKind,
          unit: r.unit,
          help: r.help,
          seriesCount: Number(r.seriesCount),
          lastSeenAt: r.lastSeenAt,
        })),
      };
    },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Decide the column value for a scrape target's bearer token. A
 * `${{ secrets.NAME }}` REFERENCE is stored verbatim (resolved against the
 * active backend at scrape time); any other non-empty string is an INLINE token
 * extracted to an encrypted internal secret (the returned marker). Undefined =>
 * no token. Always clears any prior internal secret first so an inline->reference
 * switch never orphans one.
 */
async function persistBearer({
  internalSecrets,
  targetId,
  value,
}: {
  internalSecrets: InternalSecretsService;
  targetId: string;
  value: string | undefined;
}): Promise<string | null> {
  await clearScrapeTargetBearer({ internalSecrets, targetId });
  if (value === undefined) return null;
  if (isSecretReference(value)) return value;
  return storeScrapeTargetBearer({ internalSecrets, targetId, value });
}

/**
 * Escape LIKE/ILIKE metacharacters so a search term is matched literally.
 */
export function escapeLikePattern(text: string): string {
  return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
}

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
          `metricstream: failed to invalidate ingest-token cache: ${String(error)}`,
        );
      }
    }),
  );
}

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
      "metricstream: rpcClient not provided; skipped team-grant cleanup for deleted stream (grants may orphan).",
    );
    return;
  }
  try {
    await rpcClient.forPlugin(AuthApi).deleteObjectRelations({
      objectType: metricstreamResourceTypes.stream,
      objectId: streamId,
    });
  } catch (error) {
    logger.warn(
      `metricstream: failed to delete team grants for stream ${streamId}: ${String(error)}`,
    );
  }
}

// =============================================================================
// ROW MAPPERS
// =============================================================================

function mapStreamRow(row: typeof metricStreams.$inferSelect): MetricStream {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: MetricStreamConfigSchema.parse(row.config ?? {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTokenRow(
  row: typeof metricStreamTokens.$inferSelect,
): MetricStreamToken {
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

function mapScrapeTargetRow(
  row: typeof metricScrapeTargets.$inferSelect,
): MetricScrapeTarget {
  return {
    id: row.id,
    streamId: row.streamId,
    name: row.name,
    url: row.url,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    enabled: row.enabled,
    satelliteId: row.satelliteId,
    hasBearerToken: row.bearerTokenSecret !== null,
    lastScrapeAt: row.lastScrapeAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapImportantEventRow(
  row: typeof metricImportantEvents.$inferSelect,
): ImportantEvent {
  return {
    id: row.id,
    streamId: row.streamId,
    ts: row.ts,
    type: row.type,
    title: row.title,
    detail: row.detail,
    createdAt: row.createdAt,
  };
}
