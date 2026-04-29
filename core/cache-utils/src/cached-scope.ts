import {
  createScopedCache,
  type CacheManager,
  type CacheProvider,
} from "@checkstack/cache-api";

/**
 * High-level cache helper used by routers/services that want to wrap
 * read-through caching around DB queries with safe invalidation.
 *
 * Built on top of {@link CacheProvider} but adds:
 *  - single-flight per key (no thundering herd on cache miss)
 *  - {@link wrapMany} for per-entity caching of bulk reads
 *  - prefix-based bulk invalidation (delegated to the provider)
 *  - graceful fallback to the underlying loader if the cache layer throws,
 *    so a cache outage cannot take down the read path
 */
export interface CachedScope {
  /**
   * Read-through cache for a single key. If the key is cached, returns it.
   * Otherwise calls {@link loader}, stores the result, and returns it.
   *
   * Concurrent callers for the same key share a single in-flight loader
   * promise (single-flight) so a cache miss does not stampede the DB.
   */
  wrap<T>(
    key: string,
    loader: () => Promise<T>,
    options?: { ttlMs?: number },
  ): Promise<T>;

  /**
   * Per-entity caching for bulk reads. For each id, returns the cached value
   * if present; otherwise loads it via {@link loader} and caches it. Misses
   * are loaded in parallel and concurrent loads for the same id are
   * deduplicated (single-flight).
   *
   * The {@link keyFor} function maps an id to a cache key inside this scope —
   * keep it stable so invalidation and reads agree. Use plain readable keys
   * like `status:${id}` so {@link invalidatePrefix} can target families.
   */
  wrapMany<Id, T>(
    ids: readonly Id[],
    options: {
      keyFor: (id: Id) => string;
      loader: (id: Id) => Promise<T>;
      ttlMs?: number;
    },
  ): Promise<T[]>;

  /**
   * Invalidate exactly one key. Safe to call from mutation paths.
   * Prefer this over prefix invalidation when you know the affected entity.
   */
  invalidate(key: string): Promise<void>;

  /**
   * Invalidate every key in this scope that starts with {@link prefix}.
   * Use sparingly — prefer per-entity {@link invalidate} when possible.
   * Returns the number of keys actually removed.
   */
  invalidatePrefix(prefix: string): Promise<number>;

  /** The underlying scoped {@link CacheProvider}, exposed for advanced cases. */
  readonly provider: CacheProvider;
}

/**
 * Create a {@link CachedScope} for a plugin. All keys are automatically
 * prefixed with the plugin id (via {@link createScopedCache}) so plugins
 * sharing a backend don't collide and {@link invalidatePrefix} cannot reach
 * keys belonging to other plugins.
 */
export function createCachedScope({
  cacheManager,
  pluginId,
  defaultTtlMs,
  onError,
}: {
  cacheManager: CacheManager;
  pluginId: string;
  defaultTtlMs?: number;
  /**
   * Called when a cache operation throws. Defaults to swallowing the error
   * after the loader's value has been returned — a cache failure must never
   * fail a request. Use this hook to surface metrics/logs.
   */
  onError?: (op: "get" | "set" | "delete" | "deleteByPrefix", error: unknown) => void;
}): CachedScope {
  const provider = createScopedCache({
    pluginId,
    provider: cacheManager.getProvider(),
  });

  const inflight = new Map<string, Promise<unknown>>();
  /**
   * Per-key epoch counter. Incremented on every invalidate so that an
   * in-flight loader started before invalidation cannot write stale data
   * to the cache after invalidation completes. The mutation path therefore
   * truly wins the race even if a reader had already begun a DB query
   * against pre-mutation state.
   */
  const epochs = new Map<string, number>();

  const reportError = (
    op: "get" | "set" | "delete" | "deleteByPrefix",
    error: unknown,
  ) => {
    if (onError) {
      onError(op, error);
    }
  };

  function bumpEpoch(key: string): void {
    epochs.set(key, (epochs.get(key) ?? 0) + 1);
  }

  async function wrap<T>(
    key: string,
    loader: () => Promise<T>,
    options?: { ttlMs?: number },
  ): Promise<T> {
    try {
      const cached = await provider.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    } catch (error) {
      reportError("get", error);
      // fall through to loader
    }

    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const ttlMs = options?.ttlMs ?? defaultTtlMs;
    const startEpoch = epochs.get(key) ?? 0;
    const loading = (async () => {
      try {
        const value = await loader();
        if ((epochs.get(key) ?? 0) === startEpoch) {
          try {
            await provider.set(key, value, ttlMs);
          } catch (error) {
            reportError("set", error);
          }
        }
        // If epoch changed, an invalidation happened during the load —
        // do NOT write the (now stale) value. The caller still receives
        // it (their read began before the mutation), but the next reader
        // will go to the DB and see the post-mutation state.
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, loading);
    return loading;
  }

  async function wrapMany<Id, T>(
    ids: readonly Id[],
    options: {
      keyFor: (id: Id) => string;
      loader: (id: Id) => Promise<T>;
      ttlMs?: number;
    },
  ): Promise<T[]> {
    if (ids.length === 0) {
      return [];
    }
    return Promise.all(
      ids.map((id) =>
        wrap(options.keyFor(id), () => options.loader(id), {
          ttlMs: options.ttlMs,
        }),
      ),
    );
  }

  async function invalidate(key: string): Promise<void> {
    bumpEpoch(key);
    inflight.delete(key);
    try {
      await provider.delete(key);
    } catch (error) {
      reportError("delete", error);
    }
  }

  async function invalidatePrefix(prefix: string): Promise<number> {
    for (const key of inflight.keys()) {
      if (key.startsWith(prefix)) {
        inflight.delete(key);
      }
    }
    for (const key of epochs.keys()) {
      if (key.startsWith(prefix)) {
        bumpEpoch(key);
      }
    }
    try {
      return await provider.deleteByPrefix(prefix);
    } catch (error) {
      reportError("deleteByPrefix", error);
      return 0;
    }
  }

  return { wrap, wrapMany, invalidate, invalidatePrefix, provider };
}
