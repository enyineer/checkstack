/**
 * API SEAM. This is a COMPILING STUB filled by the API-router wave (task #22):
 * the oRPC router for stream CRUD, source tokens, trace search, `getTrace`
 * waterfall, op buckets, service/operation autocomplete, overview, important
 * events and cross-stream `findTraceById`, plus the `tracestream.stream`
 * resource resolver so Teams can render grant names (rlac.md checklist #4). It
 * is registered against the contract and the storage ports. `index.ts` already
 * passes the full dependency set, so that wave only edits THIS file.
 */

import type {
  SafeDatabase,
  Logger,
  RpcService,
  RpcClient,
  EventBus,
  ResourceResolverRegistry,
} from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import type { SignalService } from "@checkstack/signal-common";
import { ilike, inArray } from "drizzle-orm";
import {
  tracestreamContract,
  tracestreamResourceTypes,
} from "@checkstack/tracestream-common";
import type * as schema from "../schema";
import { traceStreams } from "../schema";
import type { Storage } from "../storage";
import { createTracestreamService } from "./service";
import { createTracestreamRouter } from "./router";
import { createSystemLinkAuthorizer } from "./system-links-auth";

export interface RegisterApiDeps {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  rpc: RpcService;
  rpcClient: RpcClient;
  /**
   * Telemetry source-lifecycle service, forwarded to the service so
   * `deleteStream` cascades the deletion to bound telemetry sources.
   */
  sourceLifecycle: TelemetrySourceLifecycle;
  signalService: SignalService;
  resourceResolverRegistry: ResourceResolverRegistry;
  eventBus: EventBus;
  logger: Logger;
  /** Internal base URL for caller-scoped re-entry (same convention as siblings). */
  internalUrl: string;
}

/**
 * Register the tracestream oRPC router (stream CRUD, trace search + waterfall,
 * op buckets, service/operation autocomplete, overview, important events and
 * cross-stream `findTraceById`) and the `tracestream.stream` resource resolver
 * so Teams can render grant names (rlac.md checklist #4).
 *
 * The service runs entirely over the storage PORTS; the ONLY direct `db` use is
 * the resource resolver's opaque name lookup/search (the established sibling
 * pattern - the `metricstream.stream` resolver does the same, and `db` is
 * provided here precisely for it).
 */
export function registerApi({
  db,
  storage,
  rpc,
  rpcClient,
  sourceLifecycle,
  logger,
  resourceResolverRegistry,
  internalUrl,
}: RegisterApiDeps): void {
  const service = createTracestreamService({
    storage,
    logger,
    rpcClient,
    sourceLifecycle,
  });

  // Per-request gate for `setSystemLinks`: re-enters catalog AS the caller to
  // reject any linked system the caller cannot read (see system-links-auth.ts).
  const authorizeSystemLinks = createSystemLinkAuthorizer({ internalUrl });

  rpc.registerRouter(
    createTracestreamRouter({ service, authorizeSystemLinks }),
    tracestreamContract,
  );

  // Resolve/search stream names for the Teams admin UI (team grants are stored
  // as opaque `tracestream.stream:<id>` rows). Registered under the SAME
  // qualified type the access rule keys grants on (rlac.md checklist #4).
  resourceResolverRegistry.register(tracestreamResourceTypes.stream, {
    resolveNames: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select({ id: traceStreams.id, name: traceStreams.name })
        .from(traceStreams)
        .where(inArray(traceStreams.id, ids));
      return new Map(rows.map((r) => [r.id, r.name]));
    },
    search: async (query, limit) => {
      const rows = await db
        .select({ id: traceStreams.id, name: traceStreams.name })
        .from(traceStreams)
        .where(ilike(traceStreams.name, `%${query}%`))
        .limit(limit);
      return rows;
    },
  });
}
