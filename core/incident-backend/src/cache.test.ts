import { describe, test, expect, mock } from "bun:test";
import type {
  CacheManager,
  CacheProvider,
} from "@checkstack/cache-api";
import type { Logger } from "@checkstack/backend-api";
import type {
  IncidentDetail,
  IncidentWithSystems,
} from "@checkstack/incident-common";
import { createIncidentCache, type IncidentCache } from "./cache";

// Loader signatures derived from the cache's own surface, so the fakes match
// the real `IncidentService` return types without re-declaring those shapes.
type IncidentLoader = Parameters<IncidentCache["wrapIncident"]>[1];
type ListLoader = Parameters<IncidentCache["wrapList"]>[1];
type SystemLoader = Parameters<IncidentCache["wrapSystem"]>[1];

const sampleIncident: IncidentDetail = {
  id: "i1",
  title: "DB down",
  status: "investigating",
  severity: "major",
  suppressNotifications: false,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  systemIds: ["s1"],
  updates: [],
  links: [],
};

const sampleWithSystems: IncidentWithSystems = {
  id: sampleIncident.id,
  title: sampleIncident.title,
  status: sampleIncident.status,
  severity: sampleIncident.severity,
  suppressNotifications: sampleIncident.suppressNotifications,
  createdAt: sampleIncident.createdAt,
  updatedAt: sampleIncident.updatedAt,
  systemIds: sampleIncident.systemIds,
};

// Loaders return non-undefined values so the read-through cache actually
// stores them (the scope treats `undefined` as a miss).
const incidentLoaderReturning: IncidentLoader = async () => sampleIncident;
const listLoaderReturning: ListLoader = async () => [sampleWithSystems];
const systemLoaderReturning: SystemLoader = async () => [sampleWithSystems];

function createMemoryProvider(): {
  provider: CacheProvider;
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
  return { provider, store };
}

function createManager(provider: CacheProvider): CacheManager {
  return {
    getProvider: () => provider,
    getActivePlugin: () => "incident",
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
  const { provider, store } = createMemoryProvider();
  const cache = createIncidentCache({
    cacheManager: createManager(provider),
    logger: noopLogger,
  });
  return { cache, store };
}

describe("incident cache — read-through wrapping", () => {
  test("wrapIncident caches per id and only calls the loader once for a hit", async () => {
    const { cache } = makeCache();
    const loader = mock(incidentLoaderReturning);

    const a = await cache.wrapIncident("i1", loader);
    const b = await cache.wrapIncident("i1", loader);

    expect(a).toEqual(sampleIncident);
    expect(b).toEqual(sampleIncident);
    // Second read is served from cache: the loader ran only once.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("wrapList keys by filter shape — different filters do not share a slot", async () => {
    const { cache } = makeCache();
    const loaderA = mock(listLoaderReturning);
    const loaderB = mock(listLoaderReturning);

    const resA = await cache.wrapList({ status: "open" }, loaderA);
    const resB = await cache.wrapList({ status: "resolved" }, loaderB);

    expect(resA).toEqual([sampleWithSystems]);
    expect(resB).toEqual([sampleWithSystems]);
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  test("wrapList collapses key-order-different but equal filter shapes to one slot", async () => {
    const { cache } = makeCache();
    const loader = mock(listLoaderReturning);

    await cache.wrapList({ a: 1, b: 2 }, loader);
    // Same logical filter, keys in a different order -> same cache key.
    const second = await cache.wrapList({ b: 2, a: 1 }, loader);

    expect(second).toEqual([sampleWithSystems]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("wrapList treats undefined filters and {} as the same slot", async () => {
    const { cache } = makeCache();
    const loader = mock(listLoaderReturning);

    await cache.wrapList(undefined, loader);
    await cache.wrapList({}, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("incident cache — invalidation fan-out", () => {
  test("invalidateForMutation drops the incident, its systems, and all list shapes", async () => {
    const { cache } = makeCache();
    const incidentLoader = mock(incidentLoaderReturning);
    const systemLoader = mock(systemLoaderReturning);
    const listLoader = mock(listLoaderReturning);

    await cache.wrapIncident("i1", incidentLoader);
    await cache.wrapSystem("s1", systemLoader);
    await cache.wrapList({ status: "open" }, listLoader);

    await cache.invalidateForMutation({ incidentId: "i1", systemIds: ["s1"] });

    // All three must re-load on next read.
    await cache.wrapIncident("i1", incidentLoader);
    await cache.wrapSystem("s1", systemLoader);
    await cache.wrapList({ status: "open" }, listLoader);

    expect(incidentLoader).toHaveBeenCalledTimes(2);
    expect(systemLoader).toHaveBeenCalledTimes(2);
    expect(listLoader).toHaveBeenCalledTimes(2);
  });

  test("invalidateForMutation does NOT touch an unrelated incident's cache", async () => {
    const { cache } = makeCache();
    const otherLoader = mock(incidentLoaderReturning);

    await cache.wrapIncident("i2", otherLoader);
    await cache.invalidateForMutation({ incidentId: "i1", systemIds: ["s1"] });
    await cache.wrapIncident("i2", otherLoader);

    expect(otherLoader).toHaveBeenCalledTimes(1);
  });

  test("invalidateForMutation drops every affected system in one call", async () => {
    const { cache } = makeCache();
    const s1 = mock(systemLoaderReturning);
    const s2 = mock(systemLoaderReturning);

    await cache.wrapSystem("s1", s1);
    await cache.wrapSystem("s2", s2);

    await cache.invalidateForMutation({
      incidentId: "i1",
      systemIds: ["s1", "s2"],
    });

    await cache.wrapSystem("s1", s1);
    await cache.wrapSystem("s2", s2);

    expect(s1).toHaveBeenCalledTimes(2);
    expect(s2).toHaveBeenCalledTimes(2);
  });

  test("invalidateSystem drops one system's cache plus all lists, leaving incidents alone", async () => {
    const { cache } = makeCache();
    const systemLoader = mock(systemLoaderReturning);
    const listLoader = mock(listLoaderReturning);
    const incidentLoader = mock(incidentLoaderReturning);

    await cache.wrapSystem("s1", systemLoader);
    await cache.wrapList({}, listLoader);
    await cache.wrapIncident("i1", incidentLoader);

    await cache.invalidateSystem("s1");

    await cache.wrapSystem("s1", systemLoader);
    await cache.wrapList({}, listLoader);
    await cache.wrapIncident("i1", incidentLoader);

    expect(systemLoader).toHaveBeenCalledTimes(2);
    expect(listLoader).toHaveBeenCalledTimes(2);
    // The incident entry survives a system-only invalidation.
    expect(incidentLoader).toHaveBeenCalledTimes(1);
  });
});
