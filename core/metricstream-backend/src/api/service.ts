import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { AuthApi } from "@checkstack/auth-common";
import {
  MAX_CHART_EXEMPLARS,
  MetricStreamConfigSchema,
  metricstreamResourceTypes,
  type MetricStream,
  type CreateMetricStream,
  type UpdateMetricStream,
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
import type {
  ListSystemLinksResult,
  ListStreamsForSystemResult,
  ListLinkedStreamStatusesResult,
} from "@checkstack/telemetry-common";
import * as schema from "../schema";
import {
  metricStreams,
  metricNames,
  metricSeries,
  metricMinuteBuckets,
  metricHourlyBuckets,
  metricImportantEvents,
  metricStreamActivity,
  metricStreamSystemLinks,
} from "../schema";
import type { Storage } from "../storage";
import {
  chunk,
  STORAGE_CHUNK_SIZE,
  listMetricNames as listMetricNamesStorage,
} from "../storage";
import {
  createSystemLinkOperations,
  type SystemLinkOperations,
  type AssertAddedSystemsReadable,
} from "./system-links";
import {
  resolveGrain,
  rollupBoundary,
  partitionWindowAtBoundary,
  foldMetricPointsByHour,
  mergeMetricPoints,
  readBucketPoints,
} from "./buckets-merge";

/** How many stream-scoped rows to delete per batch in the deleteStream cascade. */
const CASCADE_BATCH = 5000;
/** Max concrete series a chart/aggregate selection resolves (label cardinality bound). */
const MAX_SELECTED_SERIES = 20_000;
/** Top metric names surfaced on the overview page. */
const OVERVIEW_TOP_METRICS = 5;

export interface MetricstreamService {
  createStream(input: CreateMetricStream): Promise<MetricStream>;
  updateStream(input: { id: string; body: UpdateMetricStream }): Promise<MetricStream>;
  deleteStream(input: { id: string }): Promise<void>;
  listStreams(): Promise<{ streams: MetricStream[] }>;
  listStreamSummaries(): Promise<{ summaries: MetricStreamSummary[] }>;
  getStream(input: { id: string }): Promise<MetricStream>;
  listStreamsForPicker(): Promise<StreamForPicker[]>;

  listMetricNames(input: ListMetricNames): Promise<{ names: MetricNameInfo[] }>;
  listLabelKeys(input: ListLabelKeys): Promise<{ keys: string[] }>;
  listLabelValues(input: ListLabelValues): Promise<{ values: string[] }>;
  listMetricSeries(input: ListMetricSeries): Promise<{ series: MetricSeriesInfo[] }>;
  getMetricBuckets(input: GetMetricBuckets): Promise<GetMetricBucketsResult>;
  listImportantEvents(input: ListImportantEvents): Promise<ListImportantEventsResult>;
  getStreamOverview(input: { streamId: string }): Promise<StreamOverview>;

  // System links (explicit stream -> catalog-system mapping; see ./system-links).
  // The "cannot expose what you cannot see" gate on setSystemLinks runs in the
  // router (injected authorizer), so these stay pure persistence/reads.
  listSystemLinks(input: { streamId: string }): Promise<ListSystemLinksResult>;
  setSystemLinks(input: {
    streamId: string;
    systemIds: string[];
    assertAddedReadable: AssertAddedSystemsReadable;
  }): Promise<void>;
  listStreamsForSystem(input: {
    systemId: string;
  }): Promise<ListStreamsForSystemResult>;
  listLinkedStreamStatuses(input: {
    systemIds: string[];
  }): Promise<ListLinkedStreamStatusesResult>;
}

export function createMetricstreamService({
  db,
  storage,
  logger,
  rpcClient,
  sourceLifecycle,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  logger: Logger;
  /** Platform RPC client for auth grant cleanup on stream delete (optional). */
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
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}): MetricstreamService {
  const systemLinkOps: SystemLinkOperations = createSystemLinkOperations({
    db,
    now,
  });

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
    ...systemLinkOps,

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
      // stream's series ids (batched). (Push tokens are the platform's now - a
      // `metricstream.push` source instance owns the token; deleting the source
      // there revokes it. Prometheus scrape targets likewise live in the
      // telemetry platform, whose source instances the operator manages there.)
      await withScopedTransaction(db, async (tx) => {
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

        await tx.delete(metricNames).where(eq(metricNames.streamId, id));
        await tx
          .delete(metricImportantEvents)
          .where(eq(metricImportantEvents.streamId, id));
        await tx
          .delete(metricStreamSystemLinks)
          .where(eq(metricStreamSystemLinks.streamId, id));
        await tx
          .delete(metricStreamActivity)
          .where(eq(metricStreamActivity.streamId, id));
        await tx.delete(metricStreams).where(eq(metricStreams.id, id));
      });

      // Clean up the stream's ReBAC team grants (best-effort).
      await deleteStreamGrants({ rpcClient, streamId: id, logger });

      // Cascade the deletion to the telemetry platform: strip this stream's
      // binding from every source and fully delete sources left binding-less.
      // Best-effort for the same reason as the grant cleanup - the stream's own
      // deletion already succeeded.
      await cascadeSourceDeletion({
        sourceLifecycle,
        signal: "metrics",
        streamId: id,
        logger,
      });
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
      if (seriesIds.length === 0) return { grain, points: [], exemplars: [] };

      // Union the matching series' recent exemplars over the window - the chart's
      // click-through-to-trace markers. Independent of the bucket aggregation, so
      // read it alongside (not inside) the hour-grain transaction.
      const exemplars = await storage.readSeriesExemplars({
        runner: db,
        seriesIds,
        from: input.from,
        to: input.to,
        limit: MAX_CHART_EXEMPLARS,
      });

      if (grain === "minute") {
        const points = await readBucketPoints({
          runner: db,
          seriesIds,
          from: input.from,
          to: input.to,
          grain: "minute",
        });
        return { grain, points, exemplars };
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
      return { grain: "hour", points, exemplars };
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
 * Escape LIKE/ILIKE metacharacters so a search term is matched literally.
 */
export function escapeLikePattern(text: string): string {
  return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
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

/**
 * Cascade a stream deletion to the telemetry platform via
 * `handleStreamDeleted`, so every source binding this stream is stripped and
 * sources left binding-less are fully deleted. Best-effort and idempotent: the
 * stream's own deletion already succeeded, so a lifecycle failure is logged
 * rather than rethrown. When no `sourceLifecycle` is wired, the cascade is
 * skipped with a warning.
 */
async function cascadeSourceDeletion({
  sourceLifecycle,
  signal,
  streamId,
  logger,
}: {
  sourceLifecycle?: TelemetrySourceLifecycle;
  signal: "metrics";
  streamId: string;
  logger: Logger;
}): Promise<void> {
  if (!sourceLifecycle) {
    logger.warn(
      "metricstream: telemetry source lifecycle not provided; skipped source cascade for deleted stream (bindings may orphan).",
    );
    return;
  }
  try {
    await sourceLifecycle.handleStreamDeleted({ signal, streamId });
  } catch (error) {
    logger.warn(
      `metricstream: failed to cascade telemetry source deletion for stream ${streamId}: ${String(error)}`,
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
