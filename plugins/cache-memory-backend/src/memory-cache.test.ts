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
      expect(await cache.get<{ data: string }>("key1")).toEqual({ data: "hello" });
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
});
