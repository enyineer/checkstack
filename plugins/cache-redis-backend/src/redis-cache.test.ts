import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import RedisMock from "ioredis-mock";
import { RedisCache } from "./redis-cache";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as never;

// Swap the real ioredis for ioredis-mock so these run without a live Redis.
// The mock implements getBuffer/set(PX)/unlink/scan/exists used by RedisCache.
mock.module("ioredis", () => ({ default: RedisMock }));

function makeCache(keyPrefix = ""): RedisCache {
  return new RedisCache(
    { host: "localhost", port: 6379, db: 0, keyPrefix },
    silentLogger,
  );
}

describe("RedisCache", () => {
  let cache: RedisCache;

  beforeEach(() => {
    cache = makeCache();
  });

  afterEach(async () => {
    await cache.stop();
  });

  it("round-trips a value and returns undefined on miss", async () => {
    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("a", { n: 1 });
    expect(await cache.get<{ n: number }>("a")).toEqual({ n: 1 });
  });

  it("preserves Date types through v8 serialization (not JSON)", async () => {
    const when = new Date("2026-07-09T12:00:00.000Z");
    await cache.set("d", { evaluatedAt: when, nested: new Map([["k", when]]) });
    const got = await cache.get<{ evaluatedAt: Date; nested: Map<string, Date> }>(
      "d",
    );
    expect(got?.evaluatedAt).toBeInstanceOf(Date);
    expect(got?.evaluatedAt.toISOString()).toBe(when.toISOString());
    expect(got?.nested).toBeInstanceOf(Map);
    expect(got?.nested.get("k")).toBeInstanceOf(Date);
  });

  it("expires a key after its TTL", async () => {
    await cache.set("t", "v", 20);
    expect(await cache.get<string>("t")).toBe("v");
    await new Promise((r) => setTimeout(r, 40));
    expect(await cache.get("t")).toBeUndefined();
  });

  it("delete removes a single key; has reflects existence", async () => {
    await cache.set("x", 1);
    expect(await cache.has("x")).toBe(true);
    await cache.delete("x");
    expect(await cache.has("x")).toBe(false);
    expect(await cache.get("x")).toBeUndefined();
  });

  it("deleteByPrefix removes only matching keys and returns the count", async () => {
    await cache.set("status:s1", 1);
    await cache.set("status:s1:prod", 2);
    await cache.set("status:s2", 3);
    await cache.set("other:s1", 4);

    const removed = await cache.deleteByPrefix("status:s1");
    expect(removed).toBe(2);
    expect(await cache.get("status:s1")).toBeUndefined();
    expect(await cache.get("status:s1:prod")).toBeUndefined();
    expect(await cache.get<number>("status:s2")).toBe(3); // different system, kept
    expect(await cache.get<number>("other:s1")).toBe(4); // different family, kept
  });

  it("isolates keys by instance keyPrefix", async () => {
    const a = makeCache("inst-a:cache:");
    const b = makeCache("inst-b:cache:");
    try {
      await a.set("k", "from-a");
      await b.set("k", "from-b");
      expect(await a.get<string>("k")).toBe("from-a");
      expect(await b.get<string>("k")).toBe("from-b");
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("reports cluster scope in stats", async () => {
    const stats = await cache.getStats();
    expect(stats.scope).toBe("cluster");
  });
});
