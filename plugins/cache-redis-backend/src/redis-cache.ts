import { serialize, deserialize } from "node:v8";
import Redis, { type RedisOptions } from "ioredis";
import type {
  CacheProvider,
  CacheStats,
} from "@checkstack/cache-api";
import type { Logger } from "@checkstack/backend-api";

/**
 * Resolved configuration for the Redis cache provider.
 */
export interface RedisCacheConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  /**
   * Prefix folded into EVERY key this provider reads/writes. Used to isolate a
   * secondary instance (e.g. the PR-preview instance) that shares one Redis with
   * the default instance — mirroring how the BullMQ backend namespaces its keys.
   * Empty for the default instance.
   */
  keyPrefix: string;
}

/**
 * Distributed {@link CacheProvider} backed by Redis.
 *
 * This is the backend operators wire up for HORIZONTAL SCALING: because every
 * pod talks to the same Redis, a value written or deleted by one pod is
 * immediately visible to all of them. That is what lets the platform caches
 * (health status, auth read path) stay coherent across pods WITHOUT any
 * application-level broadcast — invalidation is just a `DEL` on the shared store.
 *
 * Values are serialized with `v8.serialize` (structured-clone semantics) rather
 * than JSON so that `Date`, `Map`, `Set`, and typed arrays survive the round
 * trip with their types intact — several cached payloads (e.g. the health-status
 * response's `evaluatedAt` / `lastRunAt`) carry `Date`s that JSON would silently
 * flatten to strings.
 */
export class RedisCache implements CacheProvider {
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(config: RedisCacheConfig, logger: Logger) {
    this.prefix = config.keyPrefix;
    const options: RedisOptions = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      // Fail fast on a dead Redis instead of buffering commands forever, so the
      // CacheManager's connection test surfaces a clear error at switch time.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    };
    this.redis = new Redis(options);
    this.redis.on("error", (error: Error) => {
      logger.warn(`Redis cache connection error: ${error.message}`);
    });
  }

  /** Fold the instance key prefix into a caller-supplied (already plugin-scoped) key. */
  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const buf = await this.redis.getBuffer(this.k(key));
    if (buf === null) return undefined;
    // Deserialized bytes have no static type; the caller asserts T via the
    // generic. This cast is unavoidable for a byte-level (de)serialization
    // boundary — the value was serialized by a matching `set<T>`.
    return deserialize(buf) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const buf = serialize(value);
    // PX = expire in milliseconds. Redis rejects a non-positive PX, so clamp.
    await (ttlMs === undefined
      ? this.redis.set(this.k(key), buf)
      : this.redis.set(this.k(key), buf, "PX", Math.max(1, Math.floor(ttlMs))));
  }

  async delete(key: string): Promise<void> {
    // UNLINK reclaims memory off the main thread; DEL semantics otherwise.
    await this.redis.unlink(this.k(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const match = `${this.k(prefix)}*`;
    let cursor = "0";
    let removed = 0;
    do {
      // SCAN is O(matched) and non-blocking (unlike KEYS). Only used on rare
      // config/lifecycle invalidations, never the hot per-key path.
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        match,
        "COUNT",
        200,
      );
      cursor = next;
      if (keys.length > 0) {
        removed += await this.redis.unlink(...keys);
      }
    } while (cursor !== "0");
    return removed;
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(this.k(key))) === 1;
  }

  async getStats(): Promise<CacheStats> {
    // A shared Redis may host other prefixes (BullMQ, other instances), so a
    // cheap DBSIZE would over-count and a prefix SCAN would be O(keyspace).
    // Report only what is honest and cheap: this is a cluster-scoped cache.
    return {
      keyCount: null,
      sizeBytes: null,
      hits: null,
      misses: null,
      scope: "cluster",
    };
  }

  /** Close the Redis connection. Duck-typed by the CacheManager on shutdown/switch. */
  async stop(): Promise<void> {
    await this.redis.quit();
  }
}
