# Cache System

The cache system provides pluggable, scoped, TTL-based key-value storage for plugins.

## Architecture

The cache system follows the same plugin pattern as the [Queue System](queue-system.md):

```
core/cache-api         → CacheProvider interface, CachePlugin, CacheManager
core/cache-common      → DTOs, RPC contract, access rules
core/cache-backend     → RPC router for configuration endpoints
core/cache-frontend    → Configuration tab (registered in Infrastructure Settings)
plugins/cache-memory-backend  → In-memory implementation
plugins/cache-memory-common   → Access rules for the memory plugin
```

## CacheProvider Interface

```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
```

## Scoped Caches

Plugins MUST use `createScopedCache(pluginId, provider)` to get a `CacheProvider` that transparently prefixes all keys with the plugin ID. This prevents key collisions between plugins.

```typescript
import { createScopedCache } from "@checkstack/cache-api";

const scopedCache = createScopedCache("my-plugin", cacheManager.getProvider());
await scopedCache.set("key", value);   // stored as "my-plugin:key"
await scopedCache.get("key");          // looks up "my-plugin:key"
```

## CachePlugin Registration

Cache backends register as `CachePlugin` instances with the `CachePluginRegistry`:

```typescript
interface CachePlugin {
  id: string;
  displayName: string;
  description?: string;
  configVersion: number;
  configSchema: ZodSchema;
  createProvider(config: unknown, logger: Logger): CacheProvider;
}
```

## CacheManager

The `CacheManager` handles cache provider lifecycle:

- `getProvider()` — Returns the active `CacheProvider`
- `getActivePlugin()` — Returns the active plugin ID
- `setActiveBackend(pluginId, config)` — Switches the active backend (validates, smoke-tests, persists)
- `loadConfiguration()` — Loads persisted configuration on startup
- `shutdown()` — Stops the active provider

Unlike the Queue system, the CacheManager does **not** use a Proxy pattern. The active provider reference is replaced atomically on backend switch.

## In-Memory Cache

The default `InMemoryCache` implementation provides:

- **Passive TTL eviction**: Expired entries detected on `get()` and `has()`
- **Active sweep**: Periodic background timer removes expired entries
- **LRU-style capacity limits**: Oldest entries (by insertion order) are evicted when `maxEntries` is reached

Configuration:
- `maxEntries` (default: 10,000) — Maximum number of cache entries
- `sweepIntervalMs` (default: 60,000) — Interval for background sweep

## RPC Contract

The cache backend exposes three endpoints:

| Endpoint | Access | Description |
|---|---|---|
| `getPlugins` | `cache.settings.read` | List available cache plugins |
| `getConfiguration` | `cache.settings.read` | Get current cache configuration |
| `updateConfiguration` | `cache.settings.manage` | Switch cache backend |

## Boot Sequence

1. `CachePluginRegistryImpl` and `CacheManagerImpl` are created in `core/backend/src/index.ts`
2. Registered as core services (`coreServices.cachePluginRegistry`, `coreServices.cacheManager`)
3. Cache plugins register during plugin initialization
4. `cacheManager.loadConfiguration()` is called **after** plugin load (plugins register first)
