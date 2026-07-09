import { describe, it, expect, mock } from "bun:test";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import { AUTH_CACHE_PLUGIN_ID } from "@checkstack/auth-common";
import { createAuthCache } from "./auth-cache";

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

function setup(provider: CacheProvider = createMemoryProvider()) {
  const cache = createAuthCache({
    cacheManager: createManager(provider),
    logger: silentLogger,
  });
  return { cache, provider };
}

describe("AuthCache.resolveUserRoles", () => {
  it("serves the loader value and caches it (second read skips the loader)", async () => {
    const loadRoles = mock(async () => ["editor", "reviewer"]);
    const { cache } = setup();

    const first = await cache.resolveUserRoles({ userId: "u1", loadRoles });
    const second = await cache.resolveUserRoles({ userId: "u1", loadRoles });

    expect(first).toEqual(["editor", "reviewer"]);
    expect(second).toEqual(["editor", "reviewer"]);
    expect(loadRoles).toHaveBeenCalledTimes(1);
  });

  it("keys per user", async () => {
    const { cache } = setup();
    await cache.resolveUserRoles({ userId: "u1", loadRoles: async () => ["a"] });
    const u2 = await cache.resolveUserRoles({
      userId: "u2",
      loadRoles: async () => ["b"],
    });
    expect(u2).toEqual(["b"]);
  });

  it("invalidateUserRoles(id) forces a reload for that user only", async () => {
    const { cache } = setup();
    await cache.resolveUserRoles({ userId: "u1", loadRoles: async () => ["a"] });
    await cache.resolveUserRoles({ userId: "u2", loadRoles: async () => ["b"] });

    await cache.invalidateUserRoles("u1");

    const u1 = mock(async () => ["a2"]);
    const u2 = mock(async () => ["b2"]);
    expect(await cache.resolveUserRoles({ userId: "u1", loadRoles: u1 })).toEqual(
      ["a2"],
    );
    expect(await cache.resolveUserRoles({ userId: "u2", loadRoles: u2 })).toEqual(
      ["b"],
    ); // u2 still cached
    expect(u1).toHaveBeenCalledTimes(1);
    expect(u2).toHaveBeenCalledTimes(0);
  });

  it("invalidateUserRoles() clears every user", async () => {
    const { cache } = setup();
    await cache.resolveUserRoles({ userId: "u1", loadRoles: async () => ["a"] });
    await cache.resolveUserRoles({ userId: "u2", loadRoles: async () => ["b"] });

    await cache.invalidateUserRoles();

    const u1 = mock(async () => ["a2"]);
    const u2 = mock(async () => ["b2"]);
    await cache.resolveUserRoles({ userId: "u1", loadRoles: u1 });
    await cache.resolveUserRoles({ userId: "u2", loadRoles: u2 });
    expect(u1).toHaveBeenCalledTimes(1);
    expect(u2).toHaveBeenCalledTimes(1);
  });
});

describe("AuthCache.resolveRoleAccessRules", () => {
  it("loads only cache-miss roles in ONE batched query", async () => {
    const { cache } = setup();

    // Warm 'editor' only.
    await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["editor"],
      loadMisses: async () => new Map([["editor", ["blog.edit"]]]),
    });

    // Now resolve editor + reviewer: only 'reviewer' should be loaded, and the
    // loader must be called with EXACTLY the miss set.
    const loadMisses = mock(
      async (miss: string[]) => new Map(miss.map((r) => [r, [`${r}.rule`]])),
    );
    const result = await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["editor", "reviewer"],
      loadMisses,
    });

    expect(loadMisses).toHaveBeenCalledTimes(1);
    expect(loadMisses.mock.calls[0]![0]).toEqual(["reviewer"]);
    expect(result.get("editor")).toEqual(["blog.edit"]); // from cache
    expect(result.get("reviewer")).toEqual(["reviewer.rule"]); // freshly loaded
  });

  it("caches a role with no rules as [] (not re-loaded)", async () => {
    const { cache } = setup();
    const loadMisses = mock(async () => new Map<string, string[]>()); // returns nothing

    await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["empty"],
      loadMisses,
    });
    const second = await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["empty"],
      loadMisses,
    });

    expect(loadMisses).toHaveBeenCalledTimes(1); // second served from cache
    expect(second.get("empty")).toEqual([]);
  });

  it("never calls the loader when there are no non-admin roles", async () => {
    const { cache } = setup();
    const loadMisses = mock(async () => new Map<string, string[]>());
    const result = await cache.resolveRoleAccessRules({
      nonAdminRoleIds: [],
      loadMisses,
    });
    expect(loadMisses).toHaveBeenCalledTimes(0);
    expect(result.size).toBe(0);
  });

  it("invalidateRoleAccessRules(id) reloads only that role", async () => {
    const { cache } = setup();
    await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["editor", "reviewer"],
      loadMisses: async (miss) => new Map(miss.map((r) => [r, [`${r}.v1`]])),
    });

    await cache.invalidateRoleAccessRules("editor");

    const loadMisses = mock(
      async (miss: string[]) => new Map(miss.map((r) => [r, [`${r}.v2`]])),
    );
    const result = await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["editor", "reviewer"],
      loadMisses,
    });
    expect(loadMisses.mock.calls[0]![0]).toEqual(["editor"]); // only editor missed
    expect(result.get("editor")).toEqual(["editor.v2"]);
    expect(result.get("reviewer")).toEqual(["reviewer.v1"]); // still cached
  });
});

describe("AuthCache fail-open on cache outage", () => {
  it("resolveRoleAccessRules falls back to the loader when the provider throws", async () => {
    const brokenProvider: CacheProvider = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
      delete: async () => {},
      deleteByPrefix: async () => 0,
      has: async () => false,
    };
    const { cache } = setup(brokenProvider);

    const result = await cache.resolveRoleAccessRules({
      nonAdminRoleIds: ["editor"],
      loadMisses: async (miss) => new Map(miss.map((r) => [r, ["blog.edit"]])),
    });
    expect(result.get("editor")).toEqual(["blog.edit"]); // served from DB loader
  });
});

describe("AuthCache.invalidateAnonymousAccessRules", () => {
  it("deletes the shared anonymous-rules key under the auth scope", async () => {
    const provider = createMemoryProvider();
    const { cache } = setup(provider);

    // Simulate core/backend writing the anon entry under the SAME scope + key.
    await provider.set(`${AUTH_CACHE_PLUGIN_ID}:anonymous-access-rules`, [
      "public.read",
    ]);
    expect(
      await provider.has(`${AUTH_CACHE_PLUGIN_ID}:anonymous-access-rules`),
    ).toBe(true);

    await cache.invalidateAnonymousAccessRules();

    expect(
      await provider.has(`${AUTH_CACHE_PLUGIN_ID}:anonymous-access-rules`),
    ).toBe(false);
  });
});
