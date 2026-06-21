import { describe, test, expect, mock } from "bun:test";
import type {
  CacheManager,
  CacheProvider,
} from "@checkstack/cache-api";
import type { Logger } from "@checkstack/backend-api";
import { createSloCache } from "./cache";

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
    getActivePlugin: () => "slo",
    getActiveConfig: () => ({}),
    setActiveBackend: async () => {},
    shutdown: async () => {},
  };
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function makeCache() {
  return createSloCache({
    cacheManager: createManager(createMemoryProvider()),
    logger: noopLogger,
  });
}

describe("slo cache — read-through wrapping", () => {
  test("wrapList caches the single list slot", async () => {
    const cache = makeCache();
    const loader = mock(async () => ["objectives"]);

    await cache.wrapList(loader);
    const second = await cache.wrapList(loader);

    expect(second).toEqual(["objectives"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("wrapObjective caches per objective id", async () => {
    const cache = makeCache();
    const a = mock(async () => ({ id: "o1" }));
    const b = mock(async () => ({ id: "o2" }));

    await cache.wrapObjective("o1", a);
    await cache.wrapObjective("o1", a);
    await cache.wrapObjective("o2", b);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test("wrapSystem caches per system id", async () => {
    const cache = makeCache();
    const loader = mock(async () => ["status"]);

    await cache.wrapSystem("s1", loader);
    await cache.wrapSystem("s1", loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("slo cache — invalidateForMutation", () => {
  test("drops the list, the objective, and the system in one call", async () => {
    const cache = makeCache();
    const list = mock(async () => ["list"]);
    const obj = mock(async () => ({ id: "o1" }));
    const sys = mock(async () => ["s1"]);

    await cache.wrapList(list);
    await cache.wrapObjective("o1", obj);
    await cache.wrapSystem("s1", sys);

    await cache.invalidateForMutation({ objectiveId: "o1", systemId: "s1" });

    await cache.wrapList(list);
    await cache.wrapObjective("o1", obj);
    await cache.wrapSystem("s1", sys);

    expect(list).toHaveBeenCalledTimes(2);
    expect(obj).toHaveBeenCalledTimes(2);
    expect(sys).toHaveBeenCalledTimes(2);
  });

  test("leaves an unrelated objective and system untouched", async () => {
    const cache = makeCache();
    const obj = mock(async () => ({ id: "o2" }));
    const sys = mock(async () => ["s2"]);

    await cache.wrapObjective("o2", obj);
    await cache.wrapSystem("s2", sys);

    await cache.invalidateForMutation({ objectiveId: "o1", systemId: "s1" });

    await cache.wrapObjective("o2", obj);
    await cache.wrapSystem("s2", sys);

    expect(obj).toHaveBeenCalledTimes(1);
    expect(sys).toHaveBeenCalledTimes(1);
  });
});
