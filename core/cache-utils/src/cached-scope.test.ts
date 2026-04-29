import { describe, expect, it, mock } from "bun:test";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import { createCachedScope } from "./cached-scope";

function createMemoryProvider(): CacheProvider {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    deleteByPrefix: async (prefix) => {
      let removed = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed++;
        }
      }
      return removed;
    },
    has: async (key) => store.has(key),
  };
}

function createManager(provider: CacheProvider): CacheManager {
  return {
    getProvider: () => provider,
    getActivePlugin: () => "test",
    getActiveConfig: () => ({}),
    setActiveBackend: async () => {},
    shutdown: async () => {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createCachedScope", () => {
  describe("wrap (single-flight)", () => {
    it("returns the loader's value on a cold miss and caches it", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
      });

      const loader = mock(async () => "hello");
      const value = await scope.wrap("k", loader);

      expect(value).toBe("hello");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(await provider.get<string>("test:k")).toBe("hello");
    });

    it("returns the cached value on subsequent calls without invoking the loader", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
      });

      const loader = mock(async () => "hello");
      await scope.wrap("k", loader);
      const second = await scope.wrap("k", loader);

      expect(second).toBe("hello");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent misses for the same key (single-flight)", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
      });

      const gate = deferred<string>();
      const loader = mock(() => gate.promise);

      const a = scope.wrap("k", loader);
      const b = scope.wrap("k", loader);
      const c = scope.wrap("k", loader);

      gate.resolve("once");
      const results = await Promise.all([a, b, c]);

      expect(results).toEqual(["once", "once", "once"]);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not deduplicate across different keys", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
      });

      const loader = mock(async (key: string) => `v:${key}`);
      const [a, b] = await Promise.all([
        scope.wrap("a", () => loader("a")),
        scope.wrap("b", () => loader("b")),
      ]);

      expect(a).toBe("v:a");
      expect(b).toBe("v:b");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("does not cache loader errors and clears the in-flight slot", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
      });

      const loader = mock(async (): Promise<string> => {
        throw new Error("boom");
      });

      await expect(scope.wrap("k", loader)).rejects.toThrow("boom");
      // Second call must re-run the loader (no negative caching, no stuck in-flight).
      await expect(scope.wrap("k", loader)).rejects.toThrow("boom");
      expect(loader).toHaveBeenCalledTimes(2);
      expect(await provider.has("test:k")).toBe(false);
    });

    it("falls through to the loader if the cache get throws", async () => {
      const broken: CacheProvider = {
        ...createMemoryProvider(),
        get: async () => {
          throw new Error("cache down");
        },
      };
      const scope = createCachedScope({
        cacheManager: createManager(broken),
        pluginId: "test",
        onError: () => {},
      });

      const loader = mock(async () => "ok");
      const value = await scope.wrap("k", loader);
      expect(value).toBe("ok");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects per-call ttlMs over the scope default", async () => {
      const provider = createMemoryProvider();
      const setSpy = mock(provider.set);
      provider.set = setSpy;

      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "test",
        defaultTtlMs: 1000,
      });

      await scope.wrap("k", async () => "v", { ttlMs: 9999 });
      expect(setSpy).toHaveBeenCalledWith("test:k", "v", 9999);
    });
  });

  describe("wrapMany", () => {
    it("returns results in input order, caching per id", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "hc",
      });

      const loader = mock(async (id: string) => `status:${id}`);
      const result = await scope.wrapMany(["s1", "s2", "s3"], {
        keyFor: (id) => `status:${id}`,
        loader,
      });

      expect(result).toEqual(["status:s1", "status:s2", "status:s3"]);
      expect(loader).toHaveBeenCalledTimes(3);
      expect(await provider.get<string>("hc:status:s1")).toBe("status:s1");
      expect(await provider.get<string>("hc:status:s2")).toBe("status:s2");
    });

    it("only calls the loader for missing ids on subsequent calls", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "hc",
      });

      const loader = mock(async (id: string) => `v:${id}`);
      await scope.wrapMany(["a", "b"], {
        keyFor: (id) => `e:${id}`,
        loader,
      });
      loader.mockClear();

      const result = await scope.wrapMany(["a", "b", "c"], {
        keyFor: (id) => `e:${id}`,
        loader,
      });

      expect(result).toEqual(["v:a", "v:b", "v:c"]);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith("c");
    });

    it("returns [] for an empty id list without touching the cache", async () => {
      const provider = createMemoryProvider();
      const getSpy = mock(provider.get) as CacheProvider["get"];
      provider.get = getSpy;
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "hc",
      });

      const result = await scope.wrapMany<string, string>([], {
        keyFor: (id) => id,
        loader: async () => "x",
      });
      expect(result).toEqual([]);
      expect(getSpy).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent loads for the same id within a bulk call", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "hc",
      });

      const loader = mock(async (id: string) => `v:${id}`);

      const [first, second] = await Promise.all([
        scope.wrapMany(["a", "b"], {
          keyFor: (id) => `e:${id}`,
          loader,
        }),
        scope.wrapMany(["a", "c"], {
          keyFor: (id) => `e:${id}`,
          loader,
        }),
      ]);

      expect(first).toEqual(["v:a", "v:b"]);
      expect(second).toEqual(["v:a", "v:c"]);
      // 'a' should be loaded once across both concurrent bulks.
      expect(loader).toHaveBeenCalledTimes(3);
    });
  });

  describe("invalidate / invalidatePrefix", () => {
    it("invalidate removes a single key so the next read re-loads", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "p",
      });

      const loader = mock(async () => "v1");
      await scope.wrap("k", loader);
      await scope.invalidate("k");

      const second = await scope.wrap("k", async () => "v2");
      expect(second).toBe("v2");
    });

    it("invalidatePrefix removes every key under the prefix and reports the count", async () => {
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "p",
      });

      await scope.wrap("list:active", async () => "a");
      await scope.wrap("list:resolved", async () => "b");
      await scope.wrap("get:1", async () => "c");

      const removed = await scope.invalidatePrefix("list:");
      expect(removed).toBe(2);
      expect(await provider.has("p:list:active")).toBe(false);
      expect(await provider.has("p:list:resolved")).toBe(false);
      expect(await provider.has("p:get:1")).toBe(true);
    });

    it("invalidatePrefix cannot reach keys in other plugin scopes", async () => {
      const provider = createMemoryProvider();
      const scopeA = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "a",
      });
      const scopeB = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "b",
      });

      await scopeA.wrap("x", async () => "1");
      await scopeB.wrap("x", async () => "2");

      await scopeA.invalidatePrefix("");
      expect(await scopeB.provider.get<string>("x")).toBe("2");
    });

    it("epoch check prevents an in-flight loader from writing stale data after invalidation", async () => {
      // Race: loader's DB query was issued before the mutation's DB write
      // committed, so the loader will return pre-mutation data. The mutation
      // then runs invalidate. By the time the loader resolves, the cache
      // must NOT be repopulated with the stale value.
      const provider = createMemoryProvider();
      const scope = createCachedScope({
        cacheManager: createManager(provider),
        pluginId: "p",
      });

      const gate = deferred<string>();
      // Capture epoch synchronously when "DB query is issued" — the loader
      // body runs lazily inside wrap, which captures epoch before issuing it.
      const loader = mock(() => gate.promise);

      const reading = scope.wrap("k", loader);
      // Let wrap progress past its initial cache-miss check and start the
      // loader. Once the loader is running, simulate the mutation:
      await Promise.resolve();
      await Promise.resolve();
      await scope.invalidate("k");
      gate.resolve("pre-mutation-value");
      await reading;

      // Cache must not contain the stale value the in-flight loader returned.
      expect(await provider.has("p:k")).toBe(false);
    });
  });
});
