import { describe, it, expect } from "bun:test";
import type { CachedScope } from "@checkstack/cache-utils";
import { generateToken } from "../token-crypto";
import {
  createIngestAuthenticator,
  ingestTokenMissKey,
  NegativeTokenCache,
  NEGATIVE_CACHE_TTL_MS,
  type TokenLookup,
} from "./auth";
import { ingestTokenCacheKey } from "../api/token-cache";
import type { TokenRow } from "./token-lookup";

/**
 * In-memory CachedScope exposing only the `provider` auth uses. TTL-aware
 * against an injectable clock so negative-TTL expiry can be exercised
 * deterministically (the real cache honors ttlMs; a no-op mock would hide the
 * re-check-after-expiry path).
 */
function memoryCache(nowMs: () => number = () => Date.now()): CachedScope {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const provider = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= nowMs()) {
        store.delete(key);
        return undefined;
      }
      return entry.value as T;
    },
    set: async (key: string, value: unknown, ttlMs?: number) => {
      store.set(key, {
        value,
        expiresAt: ttlMs !== undefined ? nowMs() + ttlMs : Number.POSITIVE_INFINITY,
      });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    deleteByPrefix: async () => 0,
    has: async (key: string) => store.has(key),
  };
  return { provider } as unknown as CachedScope;
}

function countingLookup(rows: TokenRow[]): { lookup: TokenLookup; calls: () => number } {
  let calls = 0;
  const lookup: TokenLookup = async (tokenHash) => {
    calls += 1;
    return rows.find((r) => r.tokenHash === tokenHash) ?? null;
  };
  return { lookup, calls: () => calls };
}

describe("createIngestAuthenticator", () => {
  it("accepts a valid token and resolves its stream", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const rows: TokenRow[] = [
      { tokenId: "t1", streamId: "stream-1", tokenHash: gen.tokenHash, revokedAt: null },
    ];
    const { lookup } = countingLookup(rows);
    const auth = createIngestAuthenticator({ lookup, cache: memoryCache() });

    const result = await auth.verify(gen.secret);
    expect(result).toEqual({ ok: true, streamId: "stream-1", tokenId: "t1" });
  });

  it("rejects an unknown token", async () => {
    const { lookup } = countingLookup([]);
    const auth = createIngestAuthenticator({ lookup, cache: memoryCache() });
    const result = await auth.verify("ckls_unknown_secret");
    expect(result).toEqual({ ok: false, reason: "unknown" });
  });

  it("rejects a revoked token", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const rows: TokenRow[] = [
      {
        tokenId: "t1",
        streamId: "stream-1",
        tokenHash: gen.tokenHash,
        revokedAt: new Date(),
      },
    ];
    const { lookup } = countingLookup(rows);
    const auth = createIngestAuthenticator({ lookup, cache: memoryCache() });
    const result = await auth.verify(gen.secret);
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("caches the verdict so a warm token skips the DB lookup", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const rows: TokenRow[] = [
      { tokenId: "t1", streamId: "stream-1", tokenHash: gen.tokenHash, revokedAt: null },
    ];
    const { lookup, calls } = countingLookup(rows);
    const auth = createIngestAuthenticator({ lookup, cache: memoryCache() });

    await auth.verify(gen.secret);
    await auth.verify(gen.secret);
    expect(calls()).toBe(1); // second verify served from cache
  });

  it("serves a cached revoked verdict with zero DB lookups", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const cache = memoryCache();
    await cache.provider.set(
      ingestTokenCacheKey(gen.tokenHash),
      { streamId: "stream-1", tokenId: "t1", revoked: true },
      60_000,
    );
    const { lookup, calls } = countingLookup([]);
    const auth = createIngestAuthenticator({ lookup, cache });

    const result = await auth.verify(gen.secret);
    expect(result).toEqual({ ok: false, reason: "revoked" });
    expect(calls()).toBe(0); // pre-seeded verdict short-circuits the DB
  });

  it("negatively caches an unknown token so a flood hits the DB once per hash", async () => {
    const { lookup, calls } = countingLookup([]);
    const auth = createIngestAuthenticator({ lookup, cache: memoryCache() });
    await auth.verify("ckls_a_x");
    await auth.verify("ckls_a_x");
    await auth.verify("ckls_a_x");
    expect(calls()).toBe(1); // subsequent hits served from the negative cache
  });

  it("re-checks an unknown token once its negative entry has expired", async () => {
    let t = 1_000_000;
    const cache = memoryCache(() => t);
    const { lookup, calls } = countingLookup([]);
    const auth = createIngestAuthenticator({ lookup, cache, now: () => t });

    await auth.verify("ckls_a_x");
    expect(calls()).toBe(1);
    t += NEGATIVE_CACHE_TTL_MS + 1; // both the LRU and the shared marker lapse
    await auth.verify("ckls_a_x");
    expect(calls()).toBe(2);
  });

  it("damps a cross-pod flood via the shared negative marker", async () => {
    const cache = memoryCache();
    const podA = countingLookup([]);
    const podB = countingLookup([]);
    const authA = createIngestAuthenticator({ lookup: podA.lookup, cache });
    const authB = createIngestAuthenticator({ lookup: podB.lookup, cache });

    await authA.verify("ckls_a_x");
    expect(podA.calls()).toBe(1);
    // Pod B's per-pod LRU is empty, but the shared marker A wrote stops the DB hit.
    await authB.verify("ckls_a_x");
    expect(podB.calls()).toBe(0);
  });

  it("does not negatively cache a valid token (positive path unaffected)", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const cache = memoryCache();
    const rows: TokenRow[] = [
      { tokenId: "t1", streamId: "stream-1", tokenHash: gen.tokenHash, revokedAt: null },
    ];
    const { lookup } = countingLookup(rows);
    const auth = createIngestAuthenticator({ lookup, cache });

    await auth.verify(gen.secret);
    // No miss marker was written for a found token.
    expect(await cache.provider.get(ingestTokenMissKey(gen.tokenHash))).toBeUndefined();
    expect(await auth.verify(gen.secret)).toEqual({
      ok: true,
      streamId: "stream-1",
      tokenId: "t1",
    });
  });

  it("clearNegative evicts a hash so a freshly-minted token authenticates", async () => {
    const gen = generateToken({ streamId: "stream-1" });
    const cache = memoryCache();
    const { lookup } = countingLookup([]); // token unknown at first
    const auth = createIngestAuthenticator({ lookup, cache });

    expect(await auth.verify(gen.secret)).toEqual({ ok: false, reason: "unknown" });
    await auth.clearNegative?.(gen.tokenHash);
    // Shared marker gone; a subsequent verify re-queries (and could now find it).
    expect(await cache.provider.get(ingestTokenMissKey(gen.tokenHash))).toBeUndefined();
  });
});

describe("NegativeTokenCache", () => {
  it("caps its size and evicts the oldest entry (LRU)", () => {
    const cache = new NegativeTokenCache(3, 10_000);
    cache.add("a", 0);
    cache.add("b", 0);
    cache.add("c", 0);
    cache.add("d", 0); // evicts "a" (oldest)
    expect(cache.size).toBe(3);
    expect(cache.has("a", 0)).toBe(false);
    expect(cache.has("d", 0)).toBe(true);
  });

  it("keeps a recently-read entry over a colder one", () => {
    const cache = new NegativeTokenCache(2, 10_000);
    cache.add("a", 0);
    cache.add("b", 0);
    cache.has("a", 0); // refresh recency of "a"
    cache.add("c", 0); // should evict "b", not "a"
    expect(cache.has("a", 0)).toBe(true);
    expect(cache.has("b", 0)).toBe(false);
  });

  it("expires an entry after its TTL", () => {
    const cache = new NegativeTokenCache(10, 30_000);
    cache.add("a", 1_000);
    expect(cache.has("a", 20_000)).toBe(true);
    expect(cache.has("a", 31_001)).toBe(false);
    expect(cache.size).toBe(0); // expired entry pruned on read
  });
});
