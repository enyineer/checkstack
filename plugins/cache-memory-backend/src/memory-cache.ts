import type {
  CacheProvider,
  CacheStats,
  CacheEntrySummary,
  ListEntriesOptions,
  ListEntriesResult,
} from "@checkstack/cache-api";

/**
 * Internal cache entry with optional expiration tracking.
 *
 * `byteSize` is an approximation of the entry's footprint computed at
 * `set` time (UTF-8 byte length of the key plus a `v8.serialize`-based
 * snapshot of the value, with a JSON fallback). It does not include the
 * `Map` per-entry overhead and is intended for the Infrastructure runtime
 * panel, not for memory-pressure decisions.
 */
interface CacheEntry {
  value: unknown;
  /** Absolute timestamp (ms since epoch) when this entry expires, or undefined for no expiry */
  expiresAt: number | undefined;
  byteSize: number;
  /** Insertion order — used to sort by "newest" without keeping a separate index. */
  insertionSeq: number;
}

/**
 * Configuration for the InMemoryCache.
 */
export interface InMemoryCacheConfig {
  maxEntries: number;
  sweepIntervalMs: number;
}

/**
 * Approximate the byte footprint of a cache entry.
 *
 * Tries `v8.serialize` first (handles Dates, Maps, typed arrays, etc.); if
 * that throws — e.g. on functions — falls back to JSON. If both fail we
 * count just the key. The number is an estimate; treat it as a sanity gauge.
 */
function estimateEntryBytes(key: string, value: unknown): number {
  const keyBytes = Buffer.byteLength(key, "utf8");
  try {
    // Lazy require so the module stays runtime-portable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v8 = require("node:v8") as typeof import("node:v8");
    return keyBytes + v8.serialize(value).byteLength;
  } catch {
    try {
      const json = JSON.stringify(value) ?? "";
      return keyBytes + Buffer.byteLength(json, "utf8");
    } catch {
      return keyBytes;
    }
  }
}

/**
 * In-memory CacheProvider implementation using a Map.
 *
 * Features:
 * - Passive TTL eviction: expired entries are detected on `get` and `has`
 * - Active sweep: periodic background sweep removes expired entries
 * - LRU-style eviction: oldest entries are evicted when maxEntries is reached
 * - Approximate byte tracking for runtime stats
 */
export class InMemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private hitCount = 0;
  private missCount = 0;
  private byteSize = 0;
  private insertionCounter = 0;

  constructor(private config: InMemoryCacheConfig) {
    if (config.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        this.sweep();
      }, config.sweepIntervalMs);
    }
  }

  private removeEntry(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      this.byteSize -= entry.byteSize;
      this.store.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.removeEntry(key);
      this.missCount++;
      return undefined;
    }

    this.hitCount++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // If replacing, drop the old entry's bytes first.
    this.removeEntry(key);

    if (this.store.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const byteSize = estimateEntryBytes(key, value);
    this.store.set(key, {
      value,
      expiresAt: ttlMs === undefined ? undefined : Date.now() + ttlMs,
      byteSize,
      insertionSeq: ++this.insertionCounter,
    });
    this.byteSize += byteSize;
  }

  async delete(key: string): Promise<void> {
    this.removeEntry(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.removeEntry(key);
        removed++;
      }
    }
    return removed;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.removeEntry(key);
      return false;
    }

    return true;
  }

  /**
   * Sweep expired entries from the store.
   * Called periodically by the sweep timer.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.removeEntry(key);
      }
    }
  }

  /**
   * Evict the oldest entry (first in Map insertion order).
   * Provides simple LRU-style eviction.
   */
  private evictOldest(): void {
    const firstKey = this.store.keys().next().value;
    if (firstKey !== undefined) {
      this.removeEntry(firstKey);
    }
  }

  /**
   * Stop the sweep timer. Call during shutdown.
   */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /**
   * Get the current number of entries (for testing/stats).
   */
  get size(): number {
    return this.store.size;
  }

  async getStats(): Promise<CacheStats> {
    return {
      keyCount: this.store.size,
      sizeBytes: this.byteSize,
      hits: this.hitCount,
      misses: this.missCount,
      scope: "instance",
    };
  }

  async listEntries(opts: ListEntriesOptions): Promise<ListEntriesResult> {
    const limit = Math.max(0, opts.limit);
    const offset = Math.max(0, opts.offset);
    const total = this.store.size;
    if (limit === 0) {
      return { items: [], total, hasMore: total > offset };
    }

    const all: Array<CacheEntrySummary & { insertionSeq: number }> = [];
    for (const [key, entry] of this.store) {
      all.push({
        key,
        byteSize: entry.byteSize,
        expiresAt:
          entry.expiresAt === undefined ? null : new Date(entry.expiresAt),
        insertionSeq: entry.insertionSeq,
      });
    }

    if (opts.sortBy === "biggest") {
      all.sort((a, b) => b.byteSize - a.byteSize);
    } else {
      // newest first
      all.sort((a, b) => b.insertionSeq - a.insertionSeq);
    }

    const items = all
      .slice(offset, offset + limit)
      .map(({ key, byteSize, expiresAt }) => ({ key, byteSize, expiresAt }));
    return { items, total, hasMore: offset + items.length < total };
  }
}
