import type {
  Logger,
  RpcService,
  RpcClient,
  SafeDatabase,
  EventBus,
  ResourceResolverRegistry,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { SignalService } from "@checkstack/signal-common";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import type {
  SourceTokenKit,
  IngestAuthenticator,
} from "@checkstack/ingest-utils";
import { ilike, inArray } from "drizzle-orm";
import {
  metricstreamContract,
  metricstreamResourceTypes,
} from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import { metricStreams } from "../schema";
import type { Storage } from "../storage";
import {
  createMetricstreamService,
  type OnScrapeTargetsChanged,
} from "./service";
import { createMetricstreamRouter } from "./router";
import { createSatelliteBindingAuthorizer } from "../satellite/binding-auth";

/**
 * Register the metricstream oRPC router (stream CRUD, tokens, scrape-target
 * CRUD, autocomplete + viewer reads) and the `metricstream.stream` resource
 * resolver so Teams can render grant names (rlac.md checklist #4).
 *
 * `onScrapeTargetsChanged` is a SEAM: the C1 scrape reconciler's post-commit
 * (re)schedule/cancel hook. Absent (until `index.ts` wires C1's reconciler) =>
 * scrape-target mutations still persist; the reconciler re-derives its schedule
 * from the table on its next tick.
 */
export function registerApi({
  rpc,
  db,
  storage,
  cacheManager,
  logger,
  resourceResolverRegistry,
  rpcClient,
  eventBus,
  tokenKit,
  auth,
  internalSecrets,
  internalUrl,
  onScrapeTargetsChanged,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  cacheManager: CacheManager;
  signalService: SignalService;
  logger: Logger;
  resourceResolverRegistry: ResourceResolverRegistry;
  rpcClient?: RpcClient;
  eventBus?: EventBus;
  tokenKit: SourceTokenKit;
  auth: IngestAuthenticator;
  internalSecrets: InternalSecretsService;
  secretResolver: SecretResolverService;
  /** Internal base URL for the caller-scoped satellite-binding authorization. */
  internalUrl: string;
  onScrapeTargetsChanged?: OnScrapeTargetsChanged;
}): void {
  const service = createMetricstreamService({
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
  });

  rpc.registerRouter(
    createMetricstreamRouter({
      service,
      assertSatelliteBindable: createSatelliteBindingAuthorizer({ internalUrl }),
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
