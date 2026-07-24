import { describe, it, expect, mock } from "bun:test";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import type { SystemHealthStatusResponse } from "@checkstack/healthcheck-common";
import { createHealthCheckCache, type HealthStatusReader } from "./cache";

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
  } as unknown as CacheManager;
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as never;

function response(
  status: SystemHealthStatusResponse["status"],
  checks: {
    configurationId: string;
    status: SystemHealthStatusResponse["status"];
    failingSliceCount?: number;
    sliceCount?: number;
  }[] = [],
): SystemHealthStatusResponse {
  return {
    status,
    evaluatedAt: new Date(0),
    checkStatuses: checks.map((c) => ({
      configurationId: c.configurationId,
      configurationName: c.configurationId,
      status: c.status,
      runsConsidered: 1,
      sliceCount: c.sliceCount ?? 1,
      failingSliceCount: c.failingSliceCount ?? 0,
      // These tests exercise the cache's fingerprint/invalidation behaviour,
      // which reads the counts rather than the per-slice breakdown.
      slices: [],
    })),
  };
}

function setup(
  opts: {
    reader?: Partial<HealthStatusReader>;
  } = {},
) {
  const provider = createMemoryProvider();
  const reader: HealthStatusReader = {
    getSystemHealthStatus:
      opts.reader?.getSystemHealthStatus ?? (async () => response("healthy")),
    getSystemEnvironmentIds:
      opts.reader?.getSystemEnvironmentIds ?? (async () => []),
  };
  const cache = createHealthCheckCache({
    cacheManager: createManager(provider),
    logger: silentLogger,
    service: reader,
  });
  return { cache, provider };
}

describe("HealthCheckCache.read", () => {
  it("caches the loader value (second read does not re-hit the service)", async () => {
    const getSystemHealthStatus = mock(async () => response("degraded"));
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    const first = await cache.read("sys-1");
    const second = await cache.read("sys-1");

    expect(first.status).toBe("degraded");
    expect(second.status).toBe("degraded");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(1);
  });

  it("keys per (system, environment)", async () => {
    const getSystemHealthStatus = mock(
      async (_systemId: string, environmentId?: string | null) =>
        response(environmentId === "prod" ? "unhealthy" : "healthy"),
    );
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    const rollup = await cache.read("sys-1");
    const prod = await cache.read("sys-1", "prod");

    expect(rollup.status).toBe("healthy");
    expect(prod.status).toBe("unhealthy");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(2);
  });
});

describe("HealthCheckCache.reconcile", () => {
  it("evicts only when the per-check vector changed", async () => {
    let current = response("healthy", [
      { configurationId: "c1", status: "healthy" },
    ]);
    const getSystemHealthStatus = mock(async () => current);
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    // Warm the cache.
    await cache.read("sys-1");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(1);

    // A run whose vector is unchanged: no evict, cache stays warm.
    await cache.reconcile({
      systemId: "sys-1",
      previous: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
      next: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
    });
    await cache.read("sys-1");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(1); // served from cache

    // A run that flips a check: evict; next read reloads.
    current = response("degraded", [
      { configurationId: "c1", status: "degraded" },
    ]);
    await cache.reconcile({
      systemId: "sys-1",
      previous: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
      next: current,
    });
    const reloaded = await cache.read("sys-1");
    expect(reloaded.status).toBe("degraded");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(2);
  });

  it("a per-env change evicts BOTH its env key and the rollup key", async () => {
    const getSystemHealthStatus = mock(
      async (_systemId: string, environmentId?: string | null) =>
        response(environmentId === "prod" ? "unhealthy" : "healthy"),
    );
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    await cache.read("sys-1"); // warm rollup
    await cache.read("sys-1", "prod"); // warm env
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(2);

    await cache.reconcile({
      systemId: "sys-1",
      environmentId: "prod",
      previous: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
      next: response("unhealthy", [
        { configurationId: "c1", status: "unhealthy" },
      ]),
    });

    // Both the rollup and the prod key reload from the service (sibling env
    // keys would stay warm, but there are none here).
    await cache.read("sys-1");
    await cache.read("sys-1", "prod");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(4);
  });

  it("handles a simultaneous slice swap the rollup fingerprint is blind to", async () => {
    // A: unhealthy->healthy, B: healthy->unhealthy. The ROLLUP fingerprint does
    // not move (failingSliceCount stays 1, worst status stays put), so the
    // rollup is kept fresh by the per-env reconciles, not by a rollup diff.
    let rollupCall = 0;
    const getSystemHealthStatus = mock(
      async (_systemId: string, environmentId?: string | null) => {
        if (environmentId === undefined || environmentId === null) {
          rollupCall++;
          return response("unhealthy", [
            {
              configurationId: "c1",
              status: "unhealthy",
              sliceCount: 2,
              failingSliceCount: 1,
            },
          ]);
        }
        return response("healthy");
      },
    );
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    await cache.read("sys-1"); // warm rollup (rollupCall -> 1)
    await cache.reconcile({
      systemId: "sys-1",
      environmentId: "a",
      previous: response("unhealthy", [
        { configurationId: "c1", status: "unhealthy" },
      ]),
      next: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
    });
    await cache.reconcile({
      systemId: "sys-1",
      environmentId: "b",
      previous: response("healthy", [
        { configurationId: "c1", status: "healthy" },
      ]),
      next: response("unhealthy", [
        { configurationId: "c1", status: "unhealthy" },
      ]),
    });

    await cache.read("sys-1");
    expect(rollupCall).toBe(2); // rollup was evicted + reloaded despite a stable fingerprint
  });
});

describe("HealthCheckCache invalidators", () => {
  it("invalidateSystem evicts the rollup + every per-env key", async () => {
    const getSystemHealthStatus = mock(async () => response("healthy"));
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    await cache.read("sys-1"); // warm rollup
    await cache.read("sys-1", "prod"); // warm env
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(2);

    await cache.invalidateSystem("sys-1");

    await cache.read("sys-1");
    await cache.read("sys-1", "prod");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(4); // both reloaded
  });

  it("invalidateAllSystems evicts every system's status", async () => {
    const getSystemHealthStatus = mock(async () => response("healthy"));
    const { cache } = setup({ reader: { getSystemHealthStatus } });

    await cache.read("sys-1");
    await cache.read("sys-2");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(2);

    const removed = await cache.invalidateAllSystems();
    expect(removed).toBe(2);

    await cache.read("sys-1");
    await cache.read("sys-2");
    expect(getSystemHealthStatus).toHaveBeenCalledTimes(4); // both reloaded
  });
});

describe("HealthCheckCache.readMatrix", () => {
  it("assembles rollup + per-env slices from the cache", async () => {
    const getSystemHealthStatus = mock(
      async (_systemId: string, environmentId?: string | null) =>
        response(environmentId === "prod" ? "unhealthy" : "healthy", [
          { configurationId: "c1", status: "healthy" },
        ]),
    );
    const { cache } = setup({
      reader: {
        getSystemHealthStatus,
        getSystemEnvironmentIds: async () => ["prod"],
      },
    });

    const matrix = await cache.readMatrix(["sys-1"]);
    expect(matrix["sys-1"]!.status).toBe("healthy");
    expect(matrix["sys-1"]!.environments["prod"]!.status).toBe("unhealthy");
  });
});
