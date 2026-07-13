import type { CacheManager } from "@checkstack/cache-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { createIngestTokenCache as createIngestTokenCacheScope } from "@checkstack/ingest-utils";
import { pluginMetadata } from "@checkstack/logstream-common";

/**
 * The key builder + prefix are the coordinated convention shared with the ingest
 * auth path; re-exported straight from `@checkstack/ingest-utils` so both agree.
 */
export {
  INGEST_TOKEN_CACHE_PREFIX,
  ingestTokenCacheKey,
} from "@checkstack/ingest-utils";

/**
 * Shared ingest-token cache convention, bound to logstream's plugin scope. The
 * ingest auth path caches a token's verified `streamId` verdict under
 * `ingest-token:<sha256hex>` in a plugin-scoped cache; the API mutation path
 * (revoke / delete-stream) MUST invalidate the SAME key in the SAME scope so a
 * revoked token stops authenticating within the cache TTL. Both sides build the
 * scope with logstream's `pluginId` and the shared key builder from
 * `@checkstack/ingest-utils` so the prefixes agree by construction - do not
 * hand-roll a different key or a raw provider key that would miss the scope
 * prefix.
 */

/** Build the logstream-scoped cache used for ingest-token verdicts. */
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
