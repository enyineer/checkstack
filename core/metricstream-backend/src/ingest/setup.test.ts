import { describe, it, expect } from "bun:test";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import {
  createIngestTokenCache,
  ingestTokenCacheKey,
  ingestTokenMissKey,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import type { TelemetryPushTokenInvalidatedPayload } from "@checkstack/telemetry-backend";
import { applyPushTokenInvalidation } from "./setup";

const PUSH_TYPE = "metricstream.push";

/** A minimal in-process CacheManager so the scoped deletes are observable. */
function createInMemoryCacheManager(): {
  manager: CacheManager;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const provider: CacheProvider = {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    deleteByPrefix: async (prefix) => {
      let removed = 0;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    has: async (key) => store.has(key),
  };
  return {
    manager: { getProvider: () => provider } as unknown as CacheManager,
    store,
  };
}

/** Records `clearNegative` calls; `verify` is unused on this path. */
function fakeAuth(): IngestAuthenticator & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    verify: async () => ({ ok: false, reason: "unknown" }),
    clearNegative: async (hash: string) => {
      cleared.push(hash);
    },
  };
}

const payload = (
  over: Partial<TelemetryPushTokenInvalidatedPayload>,
): TelemetryPushTokenInvalidatedPayload => ({
  sourceTypeId: PUSH_TYPE,
  sourceId: "src-1",
  tokenHash: "hashA",
  reason: "revoked",
  ...over,
});

describe("applyPushTokenInvalidation", () => {
  it("revoked: deletes the shared positive verdict AND the miss marker (via the scoped provider)", async () => {
    const { manager, store } = createInMemoryCacheManager();
    const cache = createIngestTokenCache({
      cacheManager: manager,
      pluginId: "metricstream",
    });
    const auth = fakeAuth();
    // Seed the exact keys the authenticator writes for this hash.
    await cache.provider.set(ingestTokenCacheKey("hashA"), { revoked: false });
    await cache.provider.set(ingestTokenMissKey("hashA"), true);

    await applyPushTokenInvalidation({
      payload: payload({ reason: "revoked", tokenHash: "hashA" }),
      auth,
      cache,
    });

    expect(await cache.provider.get(ingestTokenCacheKey("hashA"))).toBeUndefined();
    expect(await cache.provider.get(ingestTokenMissKey("hashA"))).toBeUndefined();
    // No underlying key remains for the hash.
    expect([...store.keys()].some((k) => k.includes("hashA"))).toBe(false);
    // Revoke is served by the cache delete, not the negative-cache clear.
    expect(auth.cleared).toEqual([]);
  });

  it("minted: clears the negative cache for the fresh hash (leaves a positive verdict alone)", async () => {
    const { manager } = createInMemoryCacheManager();
    const cache = createIngestTokenCache({
      cacheManager: manager,
      pluginId: "metricstream",
    });
    const auth = fakeAuth();

    await applyPushTokenInvalidation({
      payload: payload({ reason: "minted", tokenHash: "hashB" }),
      auth,
      cache,
    });

    expect(auth.cleared).toEqual(["hashB"]);
  });

  it("ignores a payload for a DIFFERENT push source type", async () => {
    const { manager, store } = createInMemoryCacheManager();
    const cache = createIngestTokenCache({
      cacheManager: manager,
      pluginId: "metricstream",
    });
    const auth = fakeAuth();
    await cache.provider.set(ingestTokenCacheKey("hashC"), { revoked: false });

    await applyPushTokenInvalidation({
      payload: payload({
        sourceTypeId: "logstream.push",
        reason: "revoked",
        tokenHash: "hashC",
      }),
      auth,
      cache,
    });

    // Untouched: not this plugin's push type.
    expect(
      await cache.provider.get<{ revoked: boolean }>(ingestTokenCacheKey("hashC")),
    ).toEqual({ revoked: false });
    expect([...store.keys()].some((k) => k.includes("hashC"))).toBe(true);
    expect(auth.cleared).toEqual([]);
  });
});
