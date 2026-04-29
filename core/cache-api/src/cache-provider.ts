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
