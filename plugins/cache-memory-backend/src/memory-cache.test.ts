import { describe, it, expect, afterEach } from "bun:test";
import { InMemoryCache } from "./memory-cache";

describe("InMemoryCache", () => {
  const caches: InMemoryCache[] = [];

  function createCache({
    maxEntries = 100,
    sweepIntervalMs = 0,
  }: { maxEntries?: number; sweepIntervalMs?: number } = {}): InMemoryCache {
    const cache = new InMemoryCache({ maxEntries, sweepIntervalMs });
    caches.push(cache);
    return cache;
  }

  afterEach(() => {
    for (const cache of caches) {
      cache.stop();
    }
    caches.length = 0;
  });

  describe("basic operations", () => {
    it("returns undefined for missing keys", async () => {
      const cache = createCache();
      expect(await cache.get("nonexistent")).toBeUndefined();
    });

    it("stores and retrieves values", async () => {
      const cache = createCache();
      await cache.set("key1", { data: "hello" });
      expect(await cache.get<{ data: string }>("key1")).toEqual({
        data: "hello",
      });
    });

    it("stores and retrieves primitive values", async () => {
      const cache = createCache();
      await cache.set("num", 42);
      await cache.set("str", "test");
      await cache.set("bool", true);

      expect(await cache.get<number>("num")).toBe(42);
      expect(await cache.get<string>("str")).toBe("test");
      expect(await cache.get<boolean>("bool")).toBe(true);
    });

    it("overwrites existing values", async () => {
      const cache = createCache();
      await cache.set("key", "v1");
      await cache.set("key", "v2");
      expect(await cache.get<string>("key")).toBe("v2");
    });

    it("deletes values", async () => {
      const cache = createCache();
      await cache.set("key", "value");
      expect(await cache.has("key")).toBe(true);

      await cache.delete("key");
      expect(await cache.has("key")).toBe(false);
      expect(await cache.get("key")).toBeUndefined();
    });

    it("delete is a no-op for missing keys", async () => {
      const cache = createCache();
      // Should not throw
      await cache.delete("nonexistent");
    });

    it("has returns false for missing keys", async () => {
      const cache = createCache();
      expect(await cache.has("missing")).toBe(false);
    });

    it("has returns true for existing keys", async () => {
      const cache = createCache();
      await cache.set("present", 1);
      expect(await cache.has("present")).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    it("returns value before TTL expires", async () => {
      const cache = createCache();
      await cache.set("key", "value", 10_000);
      expect(await cache.get<string>("key")).toBe("value");
    });

    it("returns undefined after TTL expires (passive eviction on get)", async () => {
      const cache = createCache();
      // Set with 1ms TTL
      await cache.set("key", "value", 1);
      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await cache.get("key")).toBeUndefined();
    });

    it("has returns false after TTL expires", async () => {
      const cache = createCache();
      await cache.set("key", "value", 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await cache.has("key")).toBe(false);
    });

    it("set without TTL creates non-expiring entry", async () => {
      const cache = createCache();
      await cache.set("key", "forever");
      // Should always be available
      expect(await cache.get<string>("key")).toBe("forever");
    });

    it("overwriting resets TTL", async () => {
      const cache = createCache();
      await cache.set("key", "v1", 1);
      // Overwrite with no TTL
      await cache.set("key", "v2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Should still be available since new entry has no TTL
      expect(await cache.get<string>("key")).toBe("v2");
    });
  });

  describe("capacity eviction", () => {
    it("evicts oldest entries when maxEntries is reached", async () => {
      const cache = createCache({ maxEntries: 3 });
      await cache.set("a", 1);
      await cache.set("b", 2);
      await cache.set("c", 3);

      // Adding a 4th should evict "a" (oldest)
      await cache.set("d", 4);

      expect(await cache.has("a")).toBe(false);
      expect(await cache.get<number>("b")).toBe(2);
      expect(await cache.get<number>("c")).toBe(3);
      expect(await cache.get<number>("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("overwriting existing key does not trigger eviction", async () => {
      const cache = createCache({ maxEntries: 2 });
      await cache.set("a", 1);
      await cache.set("b", 2);

      // Overwrite "a" — should NOT evict anything
      await cache.set("a", 10);

      expect(await cache.get<number>("a")).toBe(10);
      expect(await cache.get<number>("b")).toBe(2);
      expect(cache.size).toBe(2);
    });
  });

  describe("deleteByPrefix", () => {
    it("removes only keys starting with the prefix", async () => {
      const cache = createCache();
      await cache.set("incident:list:active", "a");
      await cache.set("incident:get:1", "b");
      await cache.set("incident:get:2", "c");
      await cache.set("healthcheck:status:s1", "d");

      const removed = await cache.deleteByPrefix("incident:get:");

      expect(removed).toBe(2);
      expect(await cache.has("incident:list:active")).toBe(true);
      expect(await cache.has("incident:get:1")).toBe(false);
      expect(await cache.has("incident:get:2")).toBe(false);
      expect(await cache.has("healthcheck:status:s1")).toBe(true);
    });

    it("returns 0 when no keys match", async () => {
      const cache = createCache();
      await cache.set("foo", "bar");
      expect(await cache.deleteByPrefix("nope:")).toBe(0);
      expect(await cache.has("foo")).toBe(true);
    });

    it("treats expired entries as deletable", async () => {
      const cache = createCache();
      await cache.set("scope:a", "x", 1);
      await cache.set("scope:b", "y");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both keys are still in the underlying map (passive eviction);
      // deleteByPrefix sweeps both regardless.
      const removed = await cache.deleteByPrefix("scope:");
      expect(removed).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  describe("sweep", () => {
    it("periodic sweep removes expired entries", async () => {
      // Sweep every 10ms
      const cache = createCache({ sweepIntervalMs: 10 });
      await cache.set("expires", "value", 1);
      await cache.set("stays", "value");

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // "expires" should have been swept
      expect(cache.size).toBe(1);
      expect(await cache.get<string>("stays")).toBe("value");
    });
  });

  describe("stop", () => {
    it("stops the sweep timer", async () => {
      const cache = createCache({ sweepIntervalMs: 10 });
      cache.stop();
      // Should not throw or continue sweeping
      await cache.set("key", "value", 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Entry may or may not be expired (passive eviction), but no crash
    });
  });

  describe("getStats — byte tracking", () => {
    it("starts at zero bytes", async () => {
      const cache = createCache();
      const stats = await cache.getStats();
      expect(stats.sizeBytes).toBe(0);
      expect(stats.keyCount).toBe(0);
    });

    it("grows on set and shrinks on delete", async () => {
      const cache = createCache();
      await cache.set("k", "small");
      const afterSet = await cache.getStats();
      expect(afterSet.sizeBytes).toBeGreaterThan(0);

      await cache.delete("k");
      const afterDelete = await cache.getStats();
      expect(afterDelete.sizeBytes).toBe(0);
      expect(afterDelete.keyCount).toBe(0);
    });

    it("scales with payload size", async () => {
      const small = createCache();
      const big = createCache();
      await small.set("k", "x");
      await big.set("k", "x".repeat(10_000));
      const smallStats = await small.getStats();
      const bigStats = await big.getStats();
      expect(bigStats.sizeBytes!).toBeGreaterThan(smallStats.sizeBytes! * 100);
    });

    it("replaces (not double-counts) on overwrite", async () => {
      const cache = createCache();
      await cache.set("k", "first");
      const first = (await cache.getStats()).sizeBytes!;
      await cache.set("k", "second-but-longer-value");
      const second = (await cache.getStats()).sizeBytes!;
      expect(second).toBeGreaterThan(first);
      expect((await cache.getStats()).keyCount).toBe(1);
    });

    it("returns to zero after deleteByPrefix", async () => {
      const cache = createCache();
      await cache.set("p:a", "1");
      await cache.set("p:b", "2");
      await cache.set("other", "3");
      const removed = await cache.deleteByPrefix("p:");
      expect(removed).toBe(2);
      const stats = await cache.getStats();
      expect(stats.keyCount).toBe(1);
      expect(stats.sizeBytes!).toBeGreaterThan(0);

      await cache.delete("other");
      const empty = await cache.getStats();
      expect(empty.sizeBytes).toBe(0);
    });

    it("decrements on TTL expiry via get", async () => {
      const cache = createCache();
      await cache.set("k", "value", 10);
      expect((await cache.getStats()).sizeBytes!).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Passive eviction via get
      expect(await cache.get("k")).toBeUndefined();
      expect((await cache.getStats()).sizeBytes).toBe(0);
    });

    it("decrements on LRU eviction at capacity", async () => {
      const cache = createCache({ maxEntries: 2 });
      await cache.set("a", "x".repeat(100));
      await cache.set("b", "y".repeat(100));
      const before = (await cache.getStats()).sizeBytes!;
      await cache.set("c", "z");
      // "a" should have been evicted; size went down by ~100 bytes plus a key,
      // up by tiny amount for "c" — net should be lower than `before`.
      const after = (await cache.getStats()).sizeBytes!;
      expect(after).toBeLessThan(before);
      expect((await cache.getStats()).keyCount).toBe(2);
    });

    it("counts non-JSON-safe values via v8.serialize", async () => {
      const cache = createCache();
      await cache.set("date", new Date());
      await cache.set("map", new Map([["k", "v"]]));
      const stats = await cache.getStats();
      expect(stats.sizeBytes!).toBeGreaterThan(0);
      expect(stats.keyCount).toBe(2);
    });

    it("reports scope=instance", async () => {
      const cache = createCache();
      const stats = await cache.getStats();
      expect(stats.scope).toBe("instance");
    });
  });

  describe("listEntries", () => {
    it("returns empty when cache is empty", async () => {
      const cache = createCache();
      const result = await cache.listEntries({
        offset: 0,
        limit: 10,
        sortBy: "biggest",
      });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("sorts by size descending when sortBy=biggest", async () => {
      const cache = createCache();
      await cache.set("small", "x");
      await cache.set("big", "x".repeat(5000));
      await cache.set("medium", "x".repeat(500));

      const { items, total } = await cache.listEntries({
        offset: 0,
        limit: 10,
        sortBy: "biggest",
      });
      expect(items.map((e) => e.key)).toEqual(["big", "medium", "small"]);
      expect(total).toBe(3);
      for (let i = 1; i < items.length; i++) {
        expect(items[i - 1].byteSize).toBeGreaterThanOrEqual(
          items[i].byteSize,
        );
      }
    });

    it("sorts by insertion recency when sortBy=newest", async () => {
      const cache = createCache();
      await cache.set("first", "a");
      await cache.set("second", "b");
      await cache.set("third", "c");

      const { items } = await cache.listEntries({
        offset: 0,
        limit: 10,
        sortBy: "newest",
      });
      expect(items.map((e) => e.key)).toEqual(["third", "second", "first"]);
    });

    it("paginates with offset/limit and reports total/hasMore", async () => {
      const cache = createCache();
      for (let i = 0; i < 30; i++) {
        await cache.set(`k-${i}`, "x".repeat(i));
      }
      const page1 = await cache.listEntries({
        offset: 0,
        limit: 5,
        sortBy: "biggest",
      });
      expect(page1.items).toHaveLength(5);
      expect(page1.total).toBe(30);
      expect(page1.hasMore).toBe(true);

      const page2 = await cache.listEntries({
        offset: 5,
        limit: 5,
        sortBy: "biggest",
      });
      expect(page2.items).toHaveLength(5);
      expect(page2.items.map((e) => e.key)).not.toEqual(
        page1.items.map((e) => e.key),
      );

      const lastPage = await cache.listEntries({
        offset: 28,
        limit: 5,
        sortBy: "biggest",
      });
      expect(lastPage.items).toHaveLength(2);
      expect(lastPage.hasMore).toBe(false);
    });

    it("does NOT include cached values in summaries", async () => {
      const cache = createCache();
      await cache.set("secret", { token: "very-private" });
      const { items } = await cache.listEntries({
        offset: 0,
        limit: 10,
        sortBy: "biggest",
      });
      expect(items[0].key).toBe("secret");
      expect(Object.keys(items[0]).sort()).toEqual(
        ["byteSize", "expiresAt", "key"].sort(),
      );
    });

    it("surfaces TTL as expiresAt Date or null", async () => {
      const cache = createCache();
      await cache.set("ephemeral", "x", 60_000);
      await cache.set("forever", "y");
      const { items } = await cache.listEntries({
        offset: 0,
        limit: 10,
        sortBy: "newest",
      });
      const ephemeral = items.find((e) => e.key === "ephemeral")!;
      const forever = items.find((e) => e.key === "forever")!;
      expect(ephemeral.expiresAt).toBeInstanceOf(Date);
      expect(forever.expiresAt).toBeNull();
    });
  });
});
