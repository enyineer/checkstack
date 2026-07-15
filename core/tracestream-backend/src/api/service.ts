import { ORPCError } from "@orpc/server";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { AuthApi } from "@checkstack/auth-common";
import {
  tracestreamResourceTypes,
  type CreateTraceStream,
  type UpdateTraceStream,
  type TraceStream,
  type SearchTraces,
  type SearchTracesResult,
  type GetTrace,
  type GetTraceResult,
  type GetOpBuckets,
  type GetOpBucketsResult,
  type ListServices,
  type ListServicesResult,
  type ListOperations,
  type ListOperationsResult,
  type StreamOverview,
  type ListImportantEvents,
  type ListImportantEventsResult,
  type FindTraceById,
  type FindTraceByIdResult,
  type StreamForPicker,
  type ListStreamSummariesResult,
} from "@checkstack/tracestream-common";
import type {
  ListSystemLinks,
  ListSystemLinksResult,
  SetSystemLinks,
  ListStreamsForSystem,
  ListStreamsForSystemResult,
  ListLinkedStreamStatuses,
  ListLinkedStreamStatusesResult,
} from "@checkstack/telemetry-common";
import type { Storage } from "../storage";
import { resolveGrain } from "./grain";

/** Overview / streams-list rollups look back this far. */
const OVERVIEW_WINDOW_MS = 24 * 3_600_000;
/** Dashboard linked-stream signals consider only important events this recent. */
const LINKED_STATUS_WINDOW_MS = 24 * 3_600_000;
/** Slowest-retained quick links surfaced on the overview page. */
const OVERVIEW_SLOWEST_LIMIT = 5;
/** Top services by span volume surfaced on the overview page. */
const OVERVIEW_TOP_SERVICES = 10;

/**
 * The tracestream API service: every contract procedure implemented over the
 * storage PORTS (jobs/ingest/API never see drizzle - USER DIRECTIVE). Stream
 * config merge/defaulting is owned by the `StreamStore` adapter, so the CRUD
 * methods here are thin pass-throughs. Push-token auth is now owned by the
 * telemetry platform (`tracestream.push` source instances), so this service no
 * longer mints/revokes tokens or invalidates ingest-auth caches.
 */
export interface TracestreamService {
  createStream(input: CreateTraceStream): Promise<TraceStream>;
  updateStream(input: { id: string; body: UpdateTraceStream }): Promise<TraceStream>;
  deleteStream(input: { id: string }): Promise<void>;
  listStreams(): Promise<{ streams: TraceStream[] }>;
  listStreamSummaries(): Promise<ListStreamSummariesResult>;
  getStream(input: { id: string }): Promise<TraceStream>;
  listStreamsForPicker(): Promise<StreamForPicker[]>;

  searchTraces(input: SearchTraces): Promise<SearchTracesResult>;
  getTrace(input: GetTrace): Promise<GetTraceResult>;
  getOpBuckets(input: GetOpBuckets): Promise<GetOpBucketsResult>;
  listServices(input: ListServices): Promise<ListServicesResult>;
  listOperations(input: ListOperations): Promise<ListOperationsResult>;
  getStreamOverview(input: { streamId: string }): Promise<StreamOverview>;
  listImportantEvents(input: ListImportantEvents): Promise<ListImportantEventsResult>;
  findTraceById(input: FindTraceById): Promise<FindTraceByIdResult>;

  listSystemLinks(input: ListSystemLinks): Promise<ListSystemLinksResult>;
  /**
   * Existence gate + current persisted link set for the write path. Throws
   * NOT_FOUND if the stream does not exist, BEFORE any catalog round-trip, so
   * the router can compute the added-diff and readability-check only new ids.
   */
  getSystemLinksForWrite(input: { streamId: string }): Promise<string[]>;
  setSystemLinks(input: SetSystemLinks): Promise<void>;
  listStreamsForSystem(
    input: ListStreamsForSystem,
  ): Promise<ListStreamsForSystemResult>;
  listLinkedStreamStatuses(
    input: ListLinkedStreamStatuses,
  ): Promise<ListLinkedStreamStatusesResult>;
}

export function createTracestreamService({
  storage,
  logger,
  rpcClient,
  sourceLifecycle,
  now = () => new Date(),
}: {
  storage: Storage;
  logger: Logger;
  /** Platform RPC client for auth grant cleanup on stream delete (optional). */
  rpcClient?: RpcClient;
  /**
   * Telemetry source-lifecycle service. `deleteStream` calls
   * `handleStreamDeleted` best-effort after the stream's own data and grants are
   * gone, so the platform strips the deleted stream's binding from every source
   * and fully deletes sources left binding-less. Optional so lightweight tests
   * can omit it; when absent, `deleteStream` logs a warning and skips the
   * cascade (the stream deletion itself already succeeded).
   */
  sourceLifecycle?: TelemetrySourceLifecycle;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}): TracestreamService {
  async function getStreamOrThrow(id: string): Promise<TraceStream> {
    const stream = await storage.streams.get({ id });
    if (!stream) {
      throw new ORPCError("NOT_FOUND", { message: "Trace stream not found" });
    }
    return stream;
  }

  return {
    async createStream(input) {
      return storage.streams.create({
        name: input.name,
        description: input.description ?? null,
        config: input.config,
      });
    },

    async updateStream({ id, body }) {
      const updated = await storage.streams.update({
        id,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.config === undefined ? {} : { config: body.config }),
      });
      if (!updated) {
        throw new ORPCError("NOT_FOUND", { message: "Trace stream not found" });
      }
      return updated;
    },

    async deleteStream({ id }) {
      // Data cascade (all stream-scoped tables) then the stream ROW itself. Push
      // tokens are no longer tracestream-owned (they live on the telemetry
      // platform's `tracestream.push` source instances), so there is nothing to
      // evict here; the platform invalidates its own ingest-auth caches when a
      // source bound to a deleted stream is disabled/removed.
      await storage.deleteStreamData({ streamId: id });
      await storage.streams.delete({ id });
      await deleteStreamGrants({ rpcClient, streamId: id, logger });

      // Cascade the deletion to the telemetry platform: strip this stream's
      // binding from every source and fully delete sources left binding-less.
      // Best-effort for the same reason as the grant cleanup - the stream's own
      // deletion already succeeded.
      await cascadeSourceDeletion({
        sourceLifecycle,
        signal: "traces",
        streamId: id,
        logger,
      });
    },

    async listStreams() {
      return { streams: await storage.streams.list() };
    },

    async listStreamSummaries() {
      // ONE set-based batch per rollup (no per-row N+1): the stream list plus
      // three batched, streamId-keyed lookups the ports expose. `listKey`
      // filters each summary by its `id` (the stream id) to the readable set.
      const streams = await storage.streams.listForPicker();
      if (streams.length === 0) return { summaries: [] };
      const streamIds = streams.map((s) => s.id);
      const since = new Date(now().getTime() - OVERVIEW_WINDOW_MS);
      const [counts, serviceCounts, lastReceived] = await Promise.all([
        storage.summaries.countsForStreams({ streamIds, since }),
        storage.serviceOps.serviceCountsForStreams({ streamIds }),
        storage.activity.lastReceivedForStreams({ streamIds }),
      ]);
      const countsById = new Map(counts.map((c) => [c.streamId, c]));
      return {
        summaries: streams.map((s) => ({
          id: s.id,
          name: s.name,
          lastReceivedAt: lastReceived.get(s.id) ?? null,
          traces24h: countsById.get(s.id)?.traces24h ?? 0,
          errorTraces24h: countsById.get(s.id)?.errorTraces24h ?? 0,
          serviceCount: serviceCounts.get(s.id) ?? 0,
        })),
      };
    },

    async getStream({ id }) {
      return getStreamOrThrow(id);
    },

    async listStreamsForPicker() {
      return storage.streams.listForPicker();
    },

    async searchTraces(input) {
      return storage.summaries.searchSummaries(input);
    },

    async getTrace({ streamId, traceId }) {
      const summary = await storage.summaries.getSummary({ streamId, traceId });
      if (!summary) {
        throw new ORPCError("NOT_FOUND", { message: "Trace not found" });
      }
      const spans = await storage.spans.listSpansForTrace({ streamId, traceId });
      return { summary, spans };
    },

    async getOpBuckets(input) {
      const grain = resolveGrain({
        from: input.from,
        to: input.to,
        explicit: input.grain,
      });
      const buckets = await storage.opBuckets.queryBuckets({
        streamId: input.streamId,
        ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
        ...(input.spanName === undefined ? {} : { spanName: input.spanName }),
        from: input.from,
        to: input.to,
        grain,
      });
      return { grain, buckets };
    },

    async listServices({ streamId }) {
      return { services: await storage.serviceOps.listServices({ streamId }) };
    },

    async listOperations({ streamId, serviceName }) {
      return {
        operations: await storage.serviceOps.listOperations({
          streamId,
          serviceName,
        }),
      };
    },

    async getStreamOverview({ streamId }) {
      const since = new Date(now().getTime() - OVERVIEW_WINDOW_MS);
      const [totals24h, activity, slowestRetained, topServices] =
        await Promise.all([
          storage.summaries.overviewTotals({ streamId, since }),
          storage.activity.read({ streamId }),
          storage.summaries.slowestRetained({
            streamId,
            since,
            limit: OVERVIEW_SLOWEST_LIMIT,
          }),
          storage.opBuckets.topServices({
            streamId,
            since,
            limit: OVERVIEW_TOP_SERVICES,
          }),
        ]);
      return {
        totals24h,
        lastReceivedAt: activity?.lastReceivedAt ?? null,
        droppedSpansCount: activity?.droppedSpansCount ?? 0,
        droppedTracesCount: activity?.droppedTracesCount ?? 0,
        droppedInTransitCount: activity?.droppedInTransitCount ?? 0,
        slowestRetained,
        topServices,
      };
    },

    async listImportantEvents({ streamId, cursor, limit }) {
      // The store fetches limit+1 and returns the keyset `nextCursor` itself.
      return storage.importantEvents.list({
        streamId,
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      });
    },

    async findTraceById({ traceId }) {
      const found = await storage.summaries.findByTraceId({ traceId });
      if (found.length === 0) return { matches: [] };
      // Resolve stream names cheaply from the id+name picker projection.
      const pickers = await storage.streams.listForPicker();
      const nameById = new Map(pickers.map((p) => [p.id, p.name]));
      return {
        matches: found.map((m) => ({
          id: m.streamId,
          streamName: nameById.get(m.streamId) ?? m.streamId,
          summary: m.summary,
        })),
      };
    },

    async listSystemLinks({ streamId }) {
      return {
        systemIds: await storage.systemLinks.listSystemIdsForStream({
          streamId,
        }),
      };
    },

    async getSystemLinksForWrite({ streamId }) {
      // Existence-first: NOT_FOUND here (no catalog round-trip yet), and the
      // persisted set the router diffs against to readability-check only new ids.
      await getStreamOrThrow(streamId);
      return storage.systemLinks.listSystemIdsForStream({ streamId });
    },

    async setSystemLinks({ streamId, systemIds }) {
      // Pure replace-all persistence. The router guarantees the stream exists
      // (via getSystemLinksForWrite) and that every NEWLY ADDED system is
      // readable by the caller (the injected authorizer) BEFORE calling this.
      await storage.systemLinks.setSystemLinks({ streamId, systemIds });
    },

    async listStreamsForSystem({ systemId }) {
      return {
        streams: await storage.systemLinks.listStreamsForSystem({ systemId }),
      };
    },

    async listLinkedStreamStatuses({ systemIds }) {
      const since = new Date(now().getTime() - LINKED_STATUS_WINDOW_MS);
      return {
        matches: await storage.systemLinks.listLinkedStreamStatuses({
          systemIds,
          since,
        }),
      };
    },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/** Remove the deleted stream's ReBAC team grants (best-effort). */
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
      "tracestream: rpcClient not provided; skipped team-grant cleanup for deleted stream (grants may orphan).",
    );
    return;
  }
  try {
    await rpcClient.forPlugin(AuthApi).deleteObjectRelations({
      objectType: tracestreamResourceTypes.stream,
      objectId: streamId,
    });
  } catch (error) {
    logger.warn(
      `tracestream: failed to delete team grants for stream ${streamId}: ${String(error)}`,
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
  signal: "traces";
  streamId: string;
  logger: Logger;
}): Promise<void> {
  if (!sourceLifecycle) {
    logger.warn(
      "tracestream: telemetry source lifecycle not provided; skipped source cascade for deleted stream (bindings may orphan).",
    );
    return;
  }
  try {
    await sourceLifecycle.handleStreamDeleted({ signal, streamId });
  } catch (error) {
    logger.warn(
      `tracestream: failed to cascade telemetry source deletion for stream ${streamId}: ${String(error)}`,
    );
  }
}
