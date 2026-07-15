import type {
  SafeDatabase,
  Logger,
  RpcService,
  RpcClient,
  EventBus,
  ResourceResolverRegistry,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { SignalService } from "@checkstack/signal-common";
import { ilike, inArray } from "drizzle-orm";
import {
  logstreamContract,
  logstreamResourceTypes,
} from "@checkstack/logstream-common";
import type * as schema from "../schema";
import { logStreams } from "../schema";
import type { Storage } from "../storage";
import { createLogstreamService, type IngestCountersReader } from "./service";
import { createLogstreamRouter } from "./router";
import { createSystemLinkAuthorizer } from "./system-links-auth";
import { createPatternReferenceChecker } from "../health/pattern-references";

/**
 * Register the logstream oRPC router (stream CRUD, tokens, viewer reads) and the
 * `logstream.stream` resource resolver so Teams can render grant names
 * (plan §8, rlac.md checklist #4).
 */
export function registerApi({
  rpc,
  db,
  storage,
  cacheManager,
  signalService: _signalService,
  logger,
  rpcClient,
  eventBus,
  resourceResolverRegistry,
  ingestCounters,
  internalUrl,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  cacheManager: CacheManager;
  signalService: SignalService;
  logger: Logger;
  /**
   * Platform RPC client, forwarded to the service so `deleteStream` can clean
   * up the stream's team grants via auth's `deleteObjectRelations`. Optional so
   * tests can omit it; wire `coreServices.rpcClient` in `index.ts`.
   */
  rpcClient?: RpcClient;
  /**
   * Platform event bus, forwarded to the service so token mutations broadcast
   * `logstream.tokens.invalidated` to every pod's ingest area. Optional so
   * tests can omit it; wire `coreServices.eventBus` in `index.ts`.
   */
  eventBus?: EventBus;
  resourceResolverRegistry: ResourceResolverRegistry;
  /**
   * Optional per-pod ingest counter accessor exposed by the ingest area. When
   * absent, the overview page's `counters` field is `null` (durable rates come
   * from the buckets regardless).
   */
  ingestCounters?: IngestCountersReader;
  /**
   * Loopback base URL for the user-scoped catalog client behind the
   * `setSystemLinks` readability gate (re-enters the live router AS the caller).
   * Passed from `index.ts` like the other stream plugins.
   */
  internalUrl: string;
}): void {
  const service = createLogstreamService({
    db,
    storage,
    cacheManager,
    logger,
    rpcClient,
    eventBus,
    ingestCounters,
    // `deletePattern` refuses to orphan a referencing health check; the checker
    // enumerates health-check configs via the sanctioned cross-plugin RPC.
    findReferencingChecks: createPatternReferenceChecker({ rpcClient }),
  });

  // Per-request gate for `setSystemLinks`: re-enters catalog AS the caller to
  // verify every newly-added system is readable (injected so tests can
  // substitute a deterministic authorizer without an HTTP round-trip).
  const authorizeSystemLinks = createSystemLinkAuthorizer({ internalUrl });

  rpc.registerRouter(
    createLogstreamRouter({ service, authorizeSystemLinks }),
    logstreamContract,
  );

  // Resolve/search stream names for the Teams admin UI (team grants are stored
  // as opaque `logstream.stream:<id>` rows). Registered under the SAME qualified
  // type the access rule keys grants on (rlac.md checklist #4).
  resourceResolverRegistry.register(logstreamResourceTypes.stream, {
    resolveNames: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreams)
        .where(inArray(logStreams.id, ids));
      return new Map(rows.map((r) => [r.id, r.name]));
    },
    search: async (query, limit) => {
      const rows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreams)
        .where(ilike(logStreams.name, `%${query}%`))
        .limit(limit);
      return rows;
    },
  });
}
