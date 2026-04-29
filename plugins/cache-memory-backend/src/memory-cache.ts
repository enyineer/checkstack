import type { CacheProvider } from "@checkstack/cache-api";

/**
 * Internal cache entry with optional expiration tracking.
 */
interface CacheEntry {
  value: unknown;
  /** Absolute timestamp (ms since epoch) when this entry expires, or undefined for no expiry */
  expiresAt: number | undefined;
}

/**
 * Configuration for the InMemoryCache.
 */
export interface InMemoryCacheConfig {
  maxEntries: number;
  sweepIntervalMs: number;
}

/**
 * In-memory CacheProvider implementation using a Map.
 *
 * Features:
 * - Passive TTL eviction: expired entries are detected on `get` and `has`
 * - Active sweep: periodic background sweep removes expired entries
 * - LRU-style eviction: oldest entries are evicted when maxEntries is reached
 */
export class InMemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private config: InMemoryCacheConfig) {
    // Start periodic sweep if configured
    if (config.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        this.sweep();
      }, config.sweepIntervalMs);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Passive TTL eviction
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Evict oldest entries if at capacity (and key doesn't already exist)
    if (!this.store.has(key) && this.store.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    // Delete and re-insert to maintain insertion order for LRU
    this.store.delete(key);

    this.store.set(key, {
      value,
      expiresAt: ttlMs === undefined ? undefined : Date.now() + ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;

    // Passive TTL eviction
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
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
        this.store.delete(key);
      }
    }
  }

  /**
   * Evict the oldest entry (first in Map insertion order).
   * This provides simple LRU-style eviction.
   */
  private evictOldest(): void {
    const firstKey = this.store.keys().next().value;
    if (firstKey !== undefined) {
      this.store.delete(firstKey);
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
}
