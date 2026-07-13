import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { createIngestTokenCache as createIngestTokenCacheScope } from "@checkstack/ingest-utils";
import { pluginMetadata } from "@checkstack/metricstream-common";

/**
 * The key builders + prefixes are the coordinated convention shared with the
 * ingest auth path; re-exported straight from `@checkstack/ingest-utils` so both
 * agree by construction.
 */
export {
  INGEST_TOKEN_CACHE_PREFIX,
  ingestTokenCacheKey,
  ingestTokenMissKey,
} from "@checkstack/ingest-utils";

/**
 * Shared ingest-token cache convention, bound to metricstream's plugin scope.
 * The ingest auth path caches a token's verified `streamId` verdict under
 * `ingest-token:<sha256hex>`; the API mutation path (revoke / delete-stream)
 * MUST invalidate the SAME key in the SAME scope so a revoked token stops
 * authenticating within the cache TTL, and the mint path clears the negative
 * `ingest-token-miss:<hash>` marker so a freshly-minted token is not shadowed.
 * Both sides build the scope with metricstream's `pluginId` and the shared key
 * builders from `@checkstack/ingest-utils`.
 */
export function createIngestTokenCache({
  cacheManager,
}: {
  cacheManager: CacheManager;
}): CachedScope {
  return createIngestTokenCacheScope({
    cacheManager,
    pluginId: pluginMetadata.pluginId,
  });
}
