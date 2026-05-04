/**
 * Coarse runtime statistics about a cache backend.
 *
 * All numeric fields are nullable: a value of `null` means "the backend
 * cannot report this metric cheaply" (e.g. a remote cache where counting
 * keys would scan the whole keyspace). The Infrastructure UI renders
 * `null` as "—".
 */
export interface CacheStats {
  /** Number of cached keys, or `null` if the backend can't report it cheaply. */
  keyCount: number | null;
  /** Approximate memory footprint in bytes, or `null` if unknown. */
  sizeBytes: number | null;
  /** Hit count since the provider started, or `null` if not tracked. */
  hits: number | null;
  /** Miss count since the provider started, or `null` if not tracked. */
  misses: number | null;
  /**
   * `"instance"` if these stats reflect just this process's cache,
   * `"cluster"` if they're shared across the deployment.
   */
  scope: "instance" | "cluster";
}

/**
 * Inspection summary for a single cache entry. Used by the Infrastructure
 * runtime panel to surface "biggest values" / "newest entries". Values are
 * deliberately omitted: cached payloads can carry secrets and PII.
 */
export interface CacheEntrySummary {
  /** Fully-qualified key as stored (already plugin-prefixed). */
  key: string;
  /** Approximate byte footprint of the entry. */
  byteSize: number;
  /** Absolute expiration time, or `null` for entries with no TTL. */
  expiresAt: Date | null;
}

export interface ListEntriesOptions {
  /** Zero-based offset into the sorted result set. */
  offset: number;
  limit: number;
  sortBy: "biggest" | "newest";
}

/**
 * Paginated result for {@link CacheProvider.listEntries}.
 */
export interface ListEntriesResult {
  items: CacheEntrySummary[];
  /** Total entry count, or `null` if the backend can't compute it cheaply. */
  total: number | null;
  /** Whether more items exist past `offset + items.length`. */
  hasMore: boolean;
}

/**
 * Cache provider interface for key-value storage with optional TTL.
 *
 * Implementations should be stateless from the caller's perspective —
 * the provider manages internal state (eviction, connections, etc.)
 * but all operations are explicit via this interface.
 */
export interface CacheProvider {
  /**
   * Retrieve a cached value by key.
   * Returns undefined if the key doesn't exist or has expired.
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Store a value with an optional TTL (time-to-live) in milliseconds.
   * If the key already exists, its value and TTL are replaced.
   */
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;

  /**
   * Delete a cached value by key.
   * No-op if the key doesn't exist.
   */
  delete(key: string): Promise<void>;

  /**
   * Delete every key starting with the given prefix.
   * Used to invalidate a whole family of keys at once (e.g. all bulk results
   * for a plugin). Returns the number of keys actually removed so callers
   * can emit metrics.
   */
  deleteByPrefix(prefix: string): Promise<number>;

  /**
   * Check if a key exists and has not expired.
   */
  has(key: string): Promise<boolean>;

  /**
   * Optional: return coarse runtime statistics for the Infrastructure UI.
   *
   * Implementations that can answer this cheaply (in-process caches, or
   * remote caches with a built-in stats command) should implement it.
   * Backends without an affordable stats path should leave it unset; the
   * UI will report "stats unavailable" and the router returns all-null
   * fields.
   */
  getStats?(): Promise<CacheStats>;

  /**
   * Optional: list cache entries (without values) for the Infrastructure
   * runtime panel, paginated. Used to surface the biggest entries when the
   * cache fills up.
   *
   * Implementations should NOT return values — only key, size, and TTL.
   * Backends that can't enumerate keys cheaply (e.g. some remote caches)
   * should leave this unset.
   */
  listEntries?(opts: ListEntriesOptions): Promise<ListEntriesResult>;
}

/**
 * Creates a scoped cache that automatically prefixes all keys with the plugin ID.
 * This ensures key isolation between plugins using the same underlying CacheProvider.
 *
 * Follows the Scoped Registry Pattern used by HealthCheckRegistry and other core services.
 *
 * @param pluginId - The plugin ID to use as a key prefix
 * @param provider - The underlying CacheProvider
 * @returns A CacheProvider with keys scoped to the plugin
 */
export function createScopedCache({
  pluginId,
  provider,
}: {
  pluginId: string;
  provider: CacheProvider;
}): CacheProvider {
  const prefix = `${pluginId}:`;
  return {
    get: <T>(key: string) => provider.get<T>(`${prefix}${key}`),
    set: <T>(key: string, value: T, ttlMs?: number) =>
      provider.set<T>(`${prefix}${key}`, value, ttlMs),
    delete: (key: string) => provider.delete(`${prefix}${key}`),
    deleteByPrefix: (innerPrefix: string) =>
      provider.deleteByPrefix(`${prefix}${innerPrefix}`),
    has: (key: string) => provider.has(`${prefix}${key}`),
  };
}
