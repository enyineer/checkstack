import { describe, expect, mock, test } from "bun:test";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import {
  createSatelliteLivenessCache,
  LIVENESS_TTL_MS,
} from "./liveness-cache";
import { HEARTBEAT_INTERVAL_MS } from "@checkstack/satellite-common";

/** In-memory provider standing in for the shared platform cache. */
function fakeProvider(overrides: Partial<CacheProvider> = {}): {
  provider: CacheProvider;
  store: Map<string, unknown>;
  ttls: Map<string, number | undefined>;
} {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number | undefined>();
  const provider: CacheProvider = {
    get: async <T>(key: string) => (store.get(key) as T) ?? undefined,
    set: async <T>(key: string, value: T, ttlMs?: number) => {
      store.set(key, value);
      ttls.set(key, ttlMs);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    deleteByPrefix: async () => 0,
    has: async (key: string) => store.has(key),
    ...overrides,
  };
  return { provider, store, ttls };
}

const managerFor = (provider: CacheProvider): CacheManager =>
  ({ getProvider: () => provider }) as unknown as CacheManager;

describe("satellite liveness cache", () => {
  test("computes once and serves the second call from cache", () => {
    // The reason this exists: the executor asks per tick of every
    // satellite-only check, and the underlying read is a full table scan.
    const { provider } = fakeProvider();
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });
    const compute = mock(async () => ["sat-1"]);

    return (async () => {
      expect(await cache.getOnlineIds(compute)).toEqual(["sat-1"]);
      expect(await cache.getOnlineIds(compute)).toEqual(["sat-1"]);
      expect(compute).toHaveBeenCalledTimes(1);
    })();
  });

  test("stores with the short TTL", async () => {
    const { provider, ttls } = fakeProvider();
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    await cache.getOnlineIds(async () => ["sat-1"]);

    expect([...ttls.values()][0]).toBe(LIVENESS_TTL_MS);
  });

  test("the TTL cannot span a full online/offline transition", () => {
    // Liveness is a function of elapsed time, so the TTL has to stay well below
    // the smallest threshold the schema permits or a cached answer could hide a
    // complete state change rather than lag it by a tick.
    expect(LIVENESS_TTL_MS).toBeLessThan(HEARTBEAT_INTERVAL_MS);
  });

  test("invalidating forces a recompute", async () => {
    const { provider } = fakeProvider();
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });
    const compute = mock(async () => ["sat-1"]);

    await cache.getOnlineIds(compute);
    await cache.invalidate();
    await cache.getOnlineIds(compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  test("an empty result is still cached, not treated as a miss", async () => {
    // "No satellite is online" is a real answer and the EXPENSIVE one to
    // recompute - it is exactly the state during an outage, when every check is
    // asking. Treating it as a miss would remove the cache when it matters most.
    const { provider, store } = fakeProvider();
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    await cache.getOnlineIds(async () => []);

    expect([...store.values()][0]).toEqual([]);
  });

  test("a cache read failure degrades to the uncached answer", async () => {
    // An unreachable cache must not break the decision about whether a
    // monitoring gap is reported.
    const { provider } = fakeProvider({
      get: async () => {
        throw new Error("cache down");
      },
    });
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    expect(await cache.getOnlineIds(async () => ["sat-1"])).toEqual(["sat-1"]);
  });

  test("a cache WRITE failure still returns the fresh value", async () => {
    const { provider } = fakeProvider({
      set: async () => {
        throw new Error("cache down");
      },
    });
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    expect(await cache.getOnlineIds(async () => ["sat-1"])).toEqual(["sat-1"]);
  });

  test("a failed invalidation does not throw", async () => {
    const { provider } = fakeProvider({
      delete: async () => {
        throw new Error("cache down");
      },
    });
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    await expect(cache.invalidate()).resolves.toBeUndefined();
  });

  test("keys are plugin-scoped so they cannot collide with another plugin", async () => {
    const { provider, store } = fakeProvider();
    const cache = createSatelliteLivenessCache({
      cacheManager: managerFor(provider),
    });

    await cache.getOnlineIds(async () => ["sat-1"]);

    expect([...store.keys()][0]).toMatch(/^satellite:/);
  });
});
