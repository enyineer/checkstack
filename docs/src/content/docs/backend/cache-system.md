---
title: "Cache System"
description: "The cache system provides pluggable, scoped, TTL-based key-value storage for plugins. It mirrors the Queue System pattern: a tiny core defines the contract, and backend implementations ship as plug…"
---
# Cache System

The cache system provides pluggable, scoped, TTL-based key-value storage for plugins. It mirrors the [Queue System](queue-system.md) pattern: a tiny core defines the contract, and backend implementations ship as plugins.

## Architecture

```
core/cache-api         → CacheProvider interface, CachePlugin contract, CacheManager, scoped cache factory
core/cache-common      → DTOs, RPC contract, access rules
core/cache-backend     → RPC router for configuration endpoints
core/cache-frontend    → Configuration tab (registered in Infrastructure Settings)
plugins/cache-memory-backend  → Default in-memory implementation
plugins/cache-memory-common   → Access rules for the memory plugin
```

The core only depends on the `CacheProvider` and `CachePlugin` types — no backend implementation lives in `core/`. The default in-memory backend is a regular plugin, exactly the same as `queue-memory-backend`.

## CacheProvider Interface

All caching goes through this minimal interface, defined in [core/cache-api/src/cache-provider.ts](../../core/cache-api/src/cache-provider.ts):

```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
```

Notes:

- `get` returns `undefined` for missing **and** expired keys — TTL is enforced lazily on read.
- `set` replaces both value and TTL when the key already exists.
- `has` exists so callers can distinguish "missing" from "stored as `undefined`" without paying for full deserialization.
- Implementations must be safe to call concurrently. The provider owns its internal state (eviction, connections, sweepers); callers only see the four operations.

## Scoped Caches

Plugins must never call the underlying provider directly. The `createScopedCache` factory transparently prefixes every key with the plugin id, preventing key collisions across plugins:

```typescript
import { createScopedCache } from "@checkstack/cache-api";

const scoped = createScopedCache({
  pluginId: "my-plugin",
  provider: cacheManager.getProvider(),
});

await scoped.set("foo", value);   // physically stored as "my-plugin:foo"
await scoped.get("foo");          // looks up "my-plugin:foo"
```

The factory follows the same shape as the rest of the codebase: object-destructured arguments, `CacheProvider` in / `CacheProvider` out. See [core/cache-api/src/cache-provider.ts:43](../../core/cache-api/src/cache-provider.ts#L43).

> **Pattern**: this mirrors the scoped registry pattern used by `HealthCheckRegistry`, `CollectorRegistry`, etc. A plugin should only ever see resources scoped to itself.

## Using the Cache from a Backend Plugin

Backend plugins receive `cacheManager` via `coreServices.cacheManager` and call `getProvider()` to obtain the active provider:

```typescript
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { createScopedCache } from "@checkstack/cache-api";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        cacheManager: coreServices.cacheManager,
        logger: coreServices.logger,
      },
      init: async ({ cacheManager, logger }) => {
        const cache = createScopedCache({
          pluginId: pluginMetadata.pluginId,
          provider: cacheManager.getProvider(),
        });

        await cache.set("warm-key", { hello: "world" }, 60_000);
        const value = await cache.get<{ hello: string }>("warm-key");
        logger.info("cache demo", { value });
      },
    });
  },
});
```

Two important properties:

1. **`cacheManager.getProvider()` always returns the *currently active* provider.** When the operator switches the backend in the Infrastructure Configuration UI, `setActiveBackend` shuts down the old provider and replaces the reference atomically. Plugins should *not* cache the result of `getProvider()` long-term — re-fetch when needed, or use the value within the lifetime of the operation.
2. **`createScopedCache` is a thin wrapper, not a copy.** Calling it once per init and storing the scoped provider is fine.

For real-world usage, see [core/anomaly-backend/src/plugin.ts](../../core/anomaly-backend/src/plugin.ts) and [core/anomaly-backend/src/jobs/baseline-analyzer.ts](../../core/anomaly-backend/src/jobs/baseline-analyzer.ts) — the anomaly detection plugin caches per-field baselines under keys like `baseline:${configurationId}:${systemId}:${fieldPath}`.

## CachePlugin Contract

Cache backends implement `CachePlugin<Config>` ([core/cache-api/src/cache-plugin.ts](../../core/cache-api/src/cache-plugin.ts)):

```typescript
interface CachePlugin<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;
  configVersion: number;
  configSchema: z.ZodType<Config>;
  migrations?: Migration<unknown, unknown>[];
  createProvider(config: Config, logger: Logger): CacheProvider;
}
```

| Field | Purpose |
|---|---|
| `id` | Stable identifier (e.g. `"memory"`, `"redis"`) — referenced by configuration storage and by the Infrastructure Configuration UI. |
| `displayName` | Human-readable name shown in the cache backend selector. |
| `description` | Optional one-line description shown next to the selector. |
| `configVersion` | Current version of the plugin's `configSchema`. Increment when changing the schema in a non-additive way. |
| `configSchema` | Zod schema validating the operator-supplied configuration. The Cache Configuration tab renders form controls from this schema. |
| `migrations` | Optional list of `Migration` objects allowing old persisted configs to be upgraded to the latest version. |
| `createProvider(config, logger)` | Build and return a fresh provider for the given config. Called once per `setActiveBackend`. |

The `InMemoryCachePlugin` ([plugins/cache-memory-backend/src/plugin.ts](../../plugins/cache-memory-backend/src/plugin.ts)) is the canonical example: ~30 lines, two configurable fields (`maxEntries`, `sweepIntervalMs`).

### Authoring a New Cache Backend (e.g., Redis)

A new cache plugin is a regular backend plugin that registers itself with `cachePluginRegistry`:

```typescript
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { z } from "zod";
import type { CachePlugin, CacheProvider } from "@checkstack/cache-api";
import { pluginMetadata } from "./plugin-metadata";

const configSchema = z.object({
  url: z.string().url().describe("Redis connection URL"),
  keyPrefix: z.string().default("checkstack:"),
});

class RedisCachePlugin implements CachePlugin<z.infer<typeof configSchema>> {
  id = "redis";
  displayName = "Redis";
  description = "Distributed cache backed by Redis";
  configVersion = 1;
  configSchema = configSchema;

  createProvider(config: z.infer<typeof configSchema>, logger): CacheProvider {
    return new RedisCacheProvider(config, logger);
  }
}

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: { cachePluginRegistry: coreServices.cachePluginRegistry },
      init: ({ cachePluginRegistry }) => {
        cachePluginRegistry.register(new RedisCachePlugin());
      },
    });
  },
});
```

Implementation requirements for the provider class:

- **Honor TTL.** `set` with a `ttlMs` argument must guarantee the key disappears after that interval (passive expiry on `get` / `has` is acceptable; active sweep is encouraged).
- **Be tolerant on `get`.** Missing/expired keys must return `undefined`, never throw.
- **Be idempotent on `delete`.** Deleting a non-existent key is a no-op.
- **Be safe on shutdown.** The `CacheManager` calls `setActiveBackend` to swap providers; the old provider must release any timers, sockets, or background tasks.

## CacheManager

`CacheManager` ([core/cache-api/src/cache-manager.ts](../../core/cache-api/src/cache-manager.ts)) owns provider lifecycle:

| Method | Purpose |
|---|---|
| `getProvider()` | Returns the currently active `CacheProvider`. |
| `getActivePlugin()` | Returns the active plugin id (e.g., `"memory"`). |
| `getActiveConfig()` | Returns the persisted config object for the active plugin. |
| `setActiveBackend(pluginId, config)` | Validates config against the plugin's `configSchema`, smoke-tests the provider, persists the choice, then atomically replaces the active reference. Throws if the connection test fails. |
| `shutdown()` | Gracefully stops the active provider on application shutdown. |

Unlike `QueueManager`, the `CacheManager` does **not** use a Proxy pattern. The active provider reference is replaced atomically on backend switch. Callers always see a real provider, not a forwarding wrapper.

## RPC Contract

The cache backend exposes three RPC endpoints used by the Infrastructure Configuration UI:

| Endpoint | Access | Description |
|---|---|---|
| `getPlugins` | `cache.settings.read` | List available cache plugins (id, displayName, configSchema). |
| `getConfiguration` | `cache.settings.read` | Get the active plugin id and its current configuration. |
| `updateConfiguration` | `cache.settings.manage` | Switch the active backend (validates, smoke-tests, persists). |

## Boot Sequence

1. `CachePluginRegistryImpl` and `CacheManagerImpl` are created in `core/backend/src/index.ts`.
2. They are registered as core services (`coreServices.cachePluginRegistry`, `coreServices.cacheManager`).
3. Cache plugins (e.g., `cache-memory-backend`) register themselves during `init`.
4. After plugins have loaded, `cacheManager.loadConfiguration()` reads the persisted backend choice and instantiates the active provider.
5. Plugins that depend on the cache resolve `cacheManager.getProvider()` when they need it (typically inside `init` or `afterPluginsReady`).

## Default In-Memory Backend

The shipped `InMemoryCache` ([plugins/cache-memory-backend/src/memory-cache.ts](../../plugins/cache-memory-backend/src/memory-cache.ts)) provides:

- **Passive TTL eviction** on `get()` and `has()`.
- **Active sweep** — a background timer periodically removes expired entries.
- **LRU-style capacity limits** — oldest entries (by insertion order) are evicted when `maxEntries` is reached.

Configuration:

| Field | Default | Purpose |
|---|---|---|
| `maxEntries` | `10_000` | Maximum number of cache entries before insertion-order eviction kicks in. |
| `sweepIntervalMs` | `60_000` | Background sweep interval. Set to `0` to disable active sweeping. |

This backend is appropriate for single-instance deployments and the dev environment. For multi-instance clusters, ship a Redis (or similar) plugin and select it in the Infrastructure Configuration UI.

## Configuration UI

The cache backend is configured through the Cache tab of the Infrastructure Configuration page — see [Infrastructure Configuration](../frontend/infrastructure-config.md).

## Related Documentation

- [Queue System](queue-system.md) — sibling pattern, more sophisticated lifecycle.
- [Plugin Architecture](../architecture/plugin-system.md) — overall plugin model.
- [Infrastructure Configuration](../frontend/infrastructure-config.md) — the UI that hosts the Cache tab.
