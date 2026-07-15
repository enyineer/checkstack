import type {
  Logger,
  RpcService,
  RpcClient,
  SafeDatabase,
  ResourceResolverRegistry,
} from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { ilike, inArray } from "drizzle-orm";
import {
  metricstreamContract,
  metricstreamResourceTypes,
} from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import { metricStreams } from "../schema";
import type { Storage } from "../storage";
import { createMetricstreamService } from "./service";
import { createMetricstreamRouter } from "./router";
import { createSystemLinksReadableAuthorizer } from "./system-links-auth";

/**
 * Register the metricstream oRPC router (stream CRUD, tokens, autocomplete +
 * viewer reads, system links) and the `metricstream.stream` resource resolver so
 * Teams can render grant names (rlac.md checklist #4). Prometheus scrape targets
 * are no longer a metricstream resource - they are telemetry-platform source
 * instances (`metricstream.prometheus-scrape`).
 */
export function registerApi({
  rpc,
  db,
  storage,
  logger,
  resourceResolverRegistry,
  rpcClient,
  sourceLifecycle,
  internalUrl,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  logger: Logger;
  resourceResolverRegistry: ResourceResolverRegistry;
  rpcClient?: RpcClient;
  /**
   * Telemetry source-lifecycle service, forwarded to the service so
   * `deleteStream` cascades the deletion to bound telemetry sources. Optional so
   * tests can omit it; wire `telemetrySourceLifecycleRef` in `index.ts`.
   */
  sourceLifecycle?: TelemetrySourceLifecycle;
  /** Internal base URL for the caller-scoped system-links readability gate. */
  internalUrl: string;
}): void {
  const service = createMetricstreamService({
    db,
    storage,
    logger,
    rpcClient,
    sourceLifecycle,
  });

  rpc.registerRouter(
    createMetricstreamRouter({
      service,
      assertLinkedSystemsReadable: createSystemLinksReadableAuthorizer({
        internalUrl,
      }),
    }),
    metricstreamContract,
  );

  // Resolve/search stream names for the Teams admin UI (team grants are stored
  // as opaque `metricstream.stream:<id>` rows). Registered under the SAME
  // qualified type the access rule keys grants on (rlac.md checklist #4).
  resourceResolverRegistry.register(metricstreamResourceTypes.stream, {
    resolveNames: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select({ id: metricStreams.id, name: metricStreams.name })
        .from(metricStreams)
        .where(inArray(metricStreams.id, ids));
      return new Map(rows.map((r) => [r.id, r.name]));
    },
    search: async (query, limit) => {
      const rows = await db
        .select({ id: metricStreams.id, name: metricStreams.name })
        .from(metricStreams)
        .where(ilike(metricStreams.name, `%${query}%`))
        .limit(limit);
      return rows;
    },
  });
}
