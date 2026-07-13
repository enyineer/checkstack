/**
 * Source-token authentication for ingest endpoints, generalized over the
 * resource a token grants access to. The token IS the authorization (no RBAC
 * principal on the raw handler path): it is scoped to ingest-only for exactly
 * its resource.
 *
 * FOUND tokens are cached in the shared platform cache under the EXACT key
 * `ingest-token:<sha256hex>` (TTL 60s) so a warm token costs no DB round-trip.
 * The owning plugin's API area invalidates this same key on revoke (coordinated
 * convention - do not change the key). Positive and negative markers share the
 * scope but use DISTINCT prefixes, so a revoke deleting `ingest-token:<hash>`
 * never touches a miss entry and vice-versa.
 *
 * UNKNOWN tokens are cached NEGATIVELY so an unauthenticated flood of random
 * prefixed tokens cannot turn every request into a DB SELECT and exhaust the
 * shared connection pool. Two layers, both bounded/short-lived by construction:
 *
 *   1. A per-pod, size-capped LRU of unknown token hashes ({@link
 *      NEGATIVE_CACHE_MAX} entries, {@link NEGATIVE_CACHE_TTL_MS} TTL) - checked
 *      before any cache/DB hit, so a repeated bad token hits the DB at most once
 *      per hash per TTL on this pod, and the structure can never grow unbounded.
 *   2. A shared-cache negative entry under `ingest-token-miss:<hash>` (short
 *      TTL) so a flood spread ACROSS pods is damped too: the first pod to see a
 *      hash records the miss, the others read it instead of re-querying.
 *
 * > [!NOTE]
 * > TRADE-OFF: a token that is MINTED while its (previously unknown) hash sits in
 * > a negative cache may reject for up to {@link NEGATIVE_CACHE_TTL_MS}. The mint
 * > path is API-owned; we keep the negative TTL short rather than couple the two.
 * > {@link IngestAuthenticator.clearNegative} is exposed so the mint path CAN
 * > proactively evict a hash if that latency is ever unacceptable - but note it
 * > only clears THIS pod's LRU plus the shared entry, not other pods' LRUs, so
 * > the short TTL remains the robust guarantee.
 *
 * No bcrypt on this path: tokens are high-entropy random secrets, so a single
 * sha256 + constant-time compare is sufficient and fast.
 */

import { createCachedScope, type CachedScope } from "@checkstack/cache-utils";
import type { CacheManager } from "@checkstack/cache-api";
import { constantTimeHexEqual } from "../token/source-token-kit";

/** Key prefix for a cached ingest-token verdict, before the scope's plugin prefix. */
export const INGEST_TOKEN_CACHE_PREFIX = "ingest-token:";
/** Shared-cache key prefix for a negative (unknown-token) marker. */
export const INGEST_TOKEN_MISS_PREFIX = "ingest-token-miss:";

/** The cache key for a token identified by its sha256 hex hash. */
export function ingestTokenCacheKey(tokenHash: string): string {
  return `${INGEST_TOKEN_CACHE_PREFIX}${tokenHash}`;
}

/** Shared-cache key for a negative marker, keyed on the token's sha256 hex. */
export function ingestTokenMissKey(tokenHash: string): string {
  return `${INGEST_TOKEN_MISS_PREFIX}${tokenHash}`;
}

/**
 * Build the plugin-scoped cache used for ingest-token verdicts. Both the ingest
 * auth path and the owning plugin's revoke/delete path MUST build the scope with
 * the SAME `pluginId` so the prefixes agree by construction.
 */
export function createIngestTokenCache({
  cacheManager,
  pluginId,
}: {
  cacheManager: CacheManager;
  pluginId: string;
}): CachedScope {
  return createCachedScope({ cacheManager, pluginId });
}

export const TOKEN_CACHE_TTL_MS = 60_000;

/** Max unknown token hashes held in the per-pod negative LRU (bound memory). */
export const NEGATIVE_CACHE_MAX = 10_000;
/** How long a negative (unknown-token) verdict is trusted, per pod and shared. */
export const NEGATIVE_CACHE_TTL_MS = 30_000;

/** A token row resolved from a plugin's token table. */
export interface IngestTokenRow {
  tokenId: string;
  /** The resource this token grants ingest access to (a stream id, ...). */
  resourceId: string;
  tokenHash: string;
  revokedAt: Date | null;
}

export type IngestAuthResult =
  | { ok: true; resourceId: string; tokenId: string }
  | { ok: false; reason: "unknown" | "revoked" };

export interface IngestAuthenticator {
  /** Resolve a raw source token to its resource, or a rejection reason. */
  verify(token: string): Promise<IngestAuthResult>;
  /**
   * Evict a token hash from the negative caches (this pod's LRU + the shared
   * miss entry). Intended for the API mint path if it ever needs a just-minted
   * token to authenticate before the negative TTL elapses (see module doc).
   * Optional so lightweight test/stub authenticators need not implement it; the
   * real authenticator from {@link createIngestAuthenticator} always does.
   */
  clearNegative?(tokenHash: string): Promise<void>;
}

/** Resolve a token hash to its row (or null). Injected for testability. */
export type IngestTokenLookup = (
  tokenHash: string,
) => Promise<IngestTokenRow | null>;

/** Cached token verdict (only ever stored for tokens that exist). */
interface CachedVerdict {
  resourceId: string;
  tokenId: string;
  revoked: boolean;
}

/**
 * Size-capped, TTL'd set of token hashes known to be unknown. A plain `Map`
 * gives insertion-ordered keys, so the oldest entry is `keys().next()` - an O(1)
 * eviction. Reads refresh recency (move-to-end) so a hot bad token stays cached.
 */
export class NegativeTokenCache {
  private readonly entries = new Map<string, number>(); // hash -> expiresAtMs

  constructor(
    private readonly max: number = NEGATIVE_CACHE_MAX,
    private readonly ttlMs: number = NEGATIVE_CACHE_TTL_MS,
  ) {}

  has(hash: string, nowMs: number): boolean {
    const expiresAt = this.entries.get(hash);
    if (expiresAt === undefined) return false;
    if (expiresAt <= nowMs) {
      this.entries.delete(hash);
      return false;
    }
    // Refresh recency so eviction targets genuinely cold entries.
    this.entries.delete(hash);
    this.entries.set(hash, expiresAt);
    return true;
  }

  add(hash: string, nowMs: number): void {
    this.entries.delete(hash);
    this.entries.set(hash, nowMs + this.ttlMs);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(hash: string): void {
    this.entries.delete(hash);
  }

  get size(): number {
    return this.entries.size;
  }
}

export function createIngestAuthenticator({
  lookup,
  cache,
  hashToken,
  now = () => Date.now(),
}: {
  lookup: IngestTokenLookup;
  cache: CachedScope;
  /** sha256-hex the raw token before lookup/caching (from the source-token kit). */
  hashToken: (token: string) => string;
  /** Millisecond clock, injectable for deterministic negative-cache tests. */
  now?: () => number;
}): IngestAuthenticator {
  const negativeCache = new NegativeTokenCache();

  return {
    async verify(token) {
      const tokenHash = hashToken(token);
      const nowMs = now();

      // Layer 1: per-pod negative LRU. A repeated bad token never reaches the DB.
      if (negativeCache.has(tokenHash, nowMs)) {
        return { ok: false, reason: "unknown" };
      }

      const key = ingestTokenCacheKey(tokenHash);
      let verdict = await safeGet<CachedVerdict>(cache, key);
      if (!verdict) {
        // Layer 2: shared negative marker damps a cross-pod flood.
        const missKey = ingestTokenMissKey(tokenHash);
        if (await safeGet<true>(cache, missKey)) {
          negativeCache.add(tokenHash, nowMs);
          return { ok: false, reason: "unknown" };
        }

        const row = await lookup(tokenHash);
        if (!row) {
          negativeCache.add(tokenHash, nowMs);
          await safeSet(cache, missKey, true, NEGATIVE_CACHE_TTL_MS);
          return { ok: false, reason: "unknown" };
        }
        // Constant-time confirm the stored hash matches (defense in depth; the
        // lookup already filtered by hash).
        if (!constantTimeHexEqual(row.tokenHash, tokenHash)) {
          negativeCache.add(tokenHash, nowMs);
          await safeSet(cache, missKey, true, NEGATIVE_CACHE_TTL_MS);
          return { ok: false, reason: "unknown" };
        }
        verdict = {
          resourceId: row.resourceId,
          tokenId: row.tokenId,
          revoked: row.revokedAt !== null,
        };
        await safeSet(cache, key, verdict, TOKEN_CACHE_TTL_MS);
      }

      if (verdict.revoked) return { ok: false, reason: "revoked" };
      return { ok: true, resourceId: verdict.resourceId, tokenId: verdict.tokenId };
    },

    async clearNegative(tokenHash) {
      negativeCache.delete(tokenHash);
      try {
        await cache.provider.delete(ingestTokenMissKey(tokenHash));
      } catch {
        // best-effort; the short TTL is the robust guarantee (see module doc)
      }
    },
  };
}

async function safeGet<T>(
  cache: CachedScope,
  key: string,
): Promise<T | undefined> {
  try {
    return await cache.provider.get<T>(key);
  } catch {
    return undefined; // cache outage must never fail ingest
  }
}

async function safeSet(
  cache: CachedScope,
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  try {
    await cache.provider.set(key, value, ttlMs);
  } catch {
    // ignore; a set failure just means the next request re-reads the DB
  }
}
