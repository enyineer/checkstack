/**
 * Integration test (real Redis) for the {@link RedisCache} provider.
 *
 * The provider's ENTIRE job is to talk to a real Redis correctly: `getBuffer`
 * returning a Buffer (not a string), `set ... PX` TTL semantics, `SCAN` cursor
 * paging, `UNLINK` delete, `EXISTS`, and v8 (de)serialization fidelity across
 * the wire. A mock can only prove we CALL those commands - it cannot prove Redis
 * behaves as the code assumes. So this pins the provider against a live Redis
 * instead of a stand-in, which also lets us drop the `ioredis-mock` dev
 * dependency (and its `fengari` Lua-VM transitive surface) entirely.
 *
 * Gated behind `CHECKSTACK_IT`, so the default `bun test` never runs it. The
 * `integration` CI job sets the flag and provides a real Redis service; the URL
 * comes from `CHECKSTACK_IT_REDIS_URL` (defaulting to the `docker-compose-dev`
 * Redis port). Every key this run writes lives under a unique prefix and is
 * purged after each test, so a shared/persistent Redis never leaks state.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { Redis } from "ioredis";
import { RedisCache } from "./redis-cache";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as never;

function redisConfig(): {
  host: string;
  port: number;
  password?: string;
  db: number;
} {
  const url = new URL(
    process.env.CHECKSTACK_IT_REDIS_URL ?? "redis://localhost:6379",
  );
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db: 0,
  };
}

// Unique per run so a shared, persistent Redis never leaks state across runs or
// collides with other suites. Every cache created here nests under this prefix.
const RUN = `it:redis-cache:${Date.now()}:${Math.floor(Math.random() * 1e6)}:`;

function makeCache(sub = ""): RedisCache {
  return new RedisCache(
    { ...redisConfig(), keyPrefix: `${RUN}${sub}` },
    silentLogger,
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)("RedisCache (real Redis)", () => {
  let cache: RedisCache;
  let admin: Redis;

  beforeEach(() => {
    admin = new Redis(redisConfig());
    admin.on("error", () => {});
    cache = makeCache();
  });

  afterEach(async () => {
    // Purge every key this run wrote (the default cache plus any sub-prefixed
    // caches a test created), so tests stay hermetic on a persistent Redis.
    let cursor = "0";
    do {
      const [next, keys] = await admin.scan(
        cursor,
        "MATCH",
        `${RUN}*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length > 0) await admin.unlink(...keys);
    } while (cursor !== "0");
    await cache.stop();
    await admin.quit();
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
    await new Promise((r) => setTimeout(r, 60));
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
