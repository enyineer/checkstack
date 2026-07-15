import { ORPCError } from "@orpc/server";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import {
  createIngestTokenCache,
  ingestTokenCacheKey,
  ingestTokenMissKey,
} from "@checkstack/ingest-utils";
import { AuthApi } from "@checkstack/auth-common";
import {
  pluginMetadata,
  tracestreamResourceTypes,
  type CreateTraceStream,
  type UpdateTraceStream,
  type TraceStream,
  type TraceStreamToken,
  type MintTokenResult,
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
import { tokenKit } from "../token-crypto";
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
 * methods here are thin pass-throughs; the only non-storage concerns are source-
 * token minting (via the shared `cktr_` source-token kit) and the ingest-auth
 * cache invalidation that keeps a revoked/deleted token from authenticating.
 */
export interface TracestreamService {
  createStream(input: CreateTraceStream): Promise<TraceStream>;
  updateStream(input: { id: string; body: UpdateTraceStream }): Promise<TraceStream>;
  deleteStream(input: { id: string }): Promise<void>;
  listStreams(): Promise<{ streams: TraceStream[] }>;
  listStreamSummaries(): Promise<ListStreamSummariesResult>;
  getStream(input: { id: string }): Promise<TraceStream>;
  listStreamsForPicker(): Promise<StreamForPicker[]>;

  listTokens(input: { streamId: string }): Promise<TraceStreamToken[]>;
  mintToken(input: { streamId: string; name: string }): Promise<MintTokenResult>;
  revokeToken(input: { streamId: string; tokenId: string }): Promise<void>;

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
  cacheManager,
  logger,
  rpcClient,
  now = () => new Date(),
}: {
  storage: Storage;
  cacheManager: CacheManager;
  logger: Logger;
  /** Platform RPC client for auth grant cleanup on stream delete (optional). */
  rpcClient?: RpcClient;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}): TracestreamService {
  // Same shared source-token kit the ingest authenticator uses (keyless sha256
  // hashing), and the SAME ingest-token cache scope (pluginId + key builders
  // from `@checkstack/ingest-utils`) so a revoke/delete here evicts the exact
  // `ingest-token:<hash>` verdict the ingest auth path caches on every pod.
  const tokenCache: CachedScope = createIngestTokenCache({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
  });

  async function getStreamOrThrow(id: string): Promise<TraceStream> {
    const stream = await storage.streams.get({ id });
    if (!stream) {
      throw new ORPCError("NOT_FOUND", { message: "Trace stream not found" });
    }
    return stream;
  }

  /** Evict each token's shared positive verdict so a revoke/delete takes hold. */
  async function invalidateTokenVerdicts(tokenHashes: string[]): Promise<void> {
    await Promise.all(
      tokenHashes.map(async (hash) => {
        try {
          await tokenCache.invalidate(ingestTokenCacheKey(hash));
        } catch (error) {
          logger.warn(
            `tracestream: failed to invalidate ingest-token cache: ${String(error)}`,
          );
        }
      }),
    );
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
      // Capture the token hashes BEFORE the data cascade clears the token rows,
      // so their cached ingest-auth verdicts can be evicted after the delete.
      const tokenHashes = await storage.tokens.listHashesForStream({
        streamId: id,
      });
      // Data cascade (all stream-scoped tables) then the stream ROW itself.
      await storage.deleteStreamData({ streamId: id });
      await storage.streams.delete({ id });
      // Drop each token's shared positive verdict + negative miss marker so a
      // deleted stream's tokens stop authenticating on every pod at once.
      await invalidateTokenVerdicts(tokenHashes);
      await Promise.all(
        tokenHashes.map(async (hash) => {
          try {
            await tokenCache.provider.delete(ingestTokenMissKey(hash));
          } catch {
            // best-effort; the short negative TTL is the robust guarantee.
          }
        }),
      );
      await deleteStreamGrants({ rpcClient, streamId: id, logger });
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

    async listTokens({ streamId }) {
      return storage.tokens.list({ streamId });
    },

    async mintToken({ streamId, name }) {
      await getStreamOrThrow(streamId);
      const generated = tokenKit.generateToken({ resourceId: streamId });
      const token = await storage.tokens.insert({
        streamId,
        name,
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.tokenPrefix,
      });
      // Clear the shared negative (unknown-token) marker so the freshly-minted
      // token authenticates immediately instead of being shadowed by a stale
      // miss for up to its TTL. Best-effort.
      try {
        await tokenCache.provider.delete(ingestTokenMissKey(generated.tokenHash));
      } catch (error) {
        logger.warn(
          `tracestream: failed to clear ingest-token miss marker on mint: ${String(error)}`,
        );
      }
      // The full secret is returned ONCE here and never persisted or logged.
      return { secret: generated.secret, token };
    },

    async revokeToken({ streamId, tokenId }) {
      // Scoped to BOTH id AND streamId so a manager of `streamId` cannot revoke
      // a token belonging to another stream.
      const revoked = await storage.tokens.revoke({ streamId, tokenId });
      if (!revoked) {
        throw new ORPCError("NOT_FOUND", { message: "Token not found" });
      }
      await invalidateTokenVerdicts([revoked.tokenHash]);
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
