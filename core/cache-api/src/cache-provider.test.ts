import { describe, it, expect } from "bun:test";
import { createScopedCache, type CacheProvider } from "./cache-provider";

/**
 * Minimal in-memory CacheProvider for testing the scoped cache factory.
 */
function createTestProvider(): CacheProvider & {
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async <T>(_key: string, value: T) => {
      store.set(_key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    deleteByPrefix: async (prefix: string) => {
      let removed = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed++;
        }
      }
      return removed;
    },
    has: async (key: string) => store.has(key),
  };
}

describe("createScopedCache", () => {
  it("prefixes keys with plugin ID on set/get", async () => {
    const provider = createTestProvider();
    const scoped = createScopedCache({ pluginId: "my-plugin", provider });

    await scoped.set("baseline:abc", { mean: 42 });

    // Scoped cache should prefix the key
    expect(provider.store.has("my-plugin:baseline:abc")).toBe(true);
    expect(provider.store.has("baseline:abc")).toBe(false);

    // Scoped get should also prefix
    const result = await scoped.get<{ mean: number }>("baseline:abc");
    expect(result).toEqual({ mean: 42 });
  });

  it("prefixes keys on delete", async () => {
    const provider = createTestProvider();
    const scoped = createScopedCache({ pluginId: "test", provider });

    await scoped.set("key1", "value1");
    expect(await scoped.has("key1")).toBe(true);

    await scoped.delete("key1");
    expect(await scoped.has("key1")).toBe(false);
    expect(provider.store.has("test:key1")).toBe(false);
  });

  it("prefixes keys on has", async () => {
    const provider = createTestProvider();
    const scoped = createScopedCache({ pluginId: "plugin-a", provider });

    expect(await scoped.has("missing")).toBe(false);

    await scoped.set("exists", true);
    expect(await scoped.has("exists")).toBe(true);
  });

  it("isolates keys between different scoped caches", async () => {
    const provider = createTestProvider();
    const scopeA = createScopedCache({ pluginId: "plugin-a", provider });
    const scopeB = createScopedCache({ pluginId: "plugin-b", provider });

    await scopeA.set("shared-key", "value-a");
    await scopeB.set("shared-key", "value-b");

    // Each scope should see its own value
    expect(await scopeA.get<string>("shared-key")).toBe("value-a");
    expect(await scopeB.get<string>("shared-key")).toBe("value-b");

    // Underlying provider should have both prefixed keys
    expect(provider.store.has("plugin-a:shared-key")).toBe(true);
    expect(provider.store.has("plugin-b:shared-key")).toBe(true);
  });

  it("deleteByPrefix only removes keys under the scope's prefix", async () => {
    const provider = createTestProvider();
    const scopeA = createScopedCache({ pluginId: "a", provider });
    const scopeB = createScopedCache({ pluginId: "b", provider });

    await scopeA.set("bulk:1", "x");
    await scopeA.set("bulk:2", "y");
    await scopeA.set("other", "z");
    await scopeB.set("bulk:1", "keep");

    const removed = await scopeA.deleteByPrefix("bulk:");

    expect(removed).toBe(2);
    expect(await scopeA.has("bulk:1")).toBe(false);
    expect(await scopeA.has("bulk:2")).toBe(false);
    expect(await scopeA.has("other")).toBe(true);
    expect(await scopeB.has("bulk:1")).toBe(true);
  });

  it("deleting from one scope does not affect the other", async () => {
    const provider = createTestProvider();
    const scopeA = createScopedCache({ pluginId: "a", provider });
    const scopeB = createScopedCache({ pluginId: "b", provider });

    await scopeA.set("key", 1);
    await scopeB.set("key", 2);

    await scopeA.delete("key");

    expect(await scopeA.has("key")).toBe(false);
    expect(await scopeB.has("key")).toBe(true);
    expect(await scopeB.get<number>("key")).toBe(2);
  });
});
