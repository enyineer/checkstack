---
title: "Cache System"
description: "The cache system provides pluggable, scoped, TTL-based key-value storage for plugins. It mirrors the Queue System pattern: a tiny core defines the contract, and backend implementations ship as plug…"
---

The cache system provides pluggable, scoped, TTL-based key-value storage for plugins. It mirrors the [Queue System](/checkstack/developer-guide/backend/queue-system/) pattern: a tiny core defines the contract, and backend implementations ship as plugins.

## Architecture

```text
core/cache-api         → CacheProvider interface, CachePlugin contract, CacheManager, scoped cache factory
core/cache-common      → DTOs, RPC contract, access rules
core/cache-backend     → RPC router for configuration endpoints
core/cache-frontend    → Configuration tab (registered in Infrastructure Settings)
plugins/cache-memory-backend  → Default in-memory implementation (per-pod)
plugins/cache-memory-common   → Access rules for the memory plugin
plugins/cache-redis-backend   → Distributed Redis implementation (shared across pods)
plugins/cache-redis-common    → Access rules for the redis plugin
```

The core only depends on the `CacheProvider` and `CachePlugin` types - no backend implementation lives in `core/`. Both the default in-memory backend and the Redis backend are regular plugins, exactly the same as `queue-memory-backend` / `queue-bullmq-backend`.

Which backend is active is an operational choice with a correctness consequence: the in-memory backend is **per-pod** (each pod has its own Map), so it is only correct for single-instance deployments and dev. A horizontally-scaled cluster MUST select a distributed backend such as Redis - see [Distributed caching and horizontal scale](#distributed-caching-and-horizontal-scale).

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

- `get` returns `undefined` for missing **and** expired keys - TTL is enforced lazily on read.
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

## Instance namespacing

The default memory cache is per-process, so two instances sharing infrastructure are already isolated - no namespacing is needed. A SHARED cache provider (such as the Redis backend) that could be reached by more than one instance MUST namespace its keys so a secondary instance cannot collide with the default one. Fold `coreServices.instanceRuntime.namespace` into the key prefix your provider builds, exactly as the BullMQ queue backend does. The shipped `cache-redis-backend` does this: it folds the namespace into its `keyPrefix` (`<namespace>:cache:` for a secondary instance, `cache:` for the default), so the PR-preview instance and the default instance share one Redis without colliding. See [Parallel instances and namespacing](/checkstack/developer-guide/architecture/parallel-instances/).

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

1. **`cacheManager.getProvider()` always returns the *currently active* provider.** When the operator switches the backend in the Infrastructure Configuration UI, `setActiveBackend` shuts down the old provider and replaces the reference atomically. Plugins should *not* cache the result of `getProvider()` long-term - re-fetch when needed, or use the value within the lifetime of the operation.
2. **`createScopedCache` is a thin wrapper, not a copy.** Calling it once per init and storing the scoped provider is fine.

For real-world usage, see [core/anomaly-backend/src/plugin.ts](../../core/anomaly-backend/src/plugin.ts) and [core/anomaly-backend/src/jobs/baseline-analyzer.ts](../../core/anomaly-backend/src/jobs/baseline-analyzer.ts) - the anomaly detection plugin caches per-field baselines under keys like `baseline:${configurationId}:${systemId}:${fieldPath}`.

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
| `id` | Stable identifier (e.g. `"memory"`, `"redis"`) - referenced by configuration storage and by the Infrastructure Configuration UI. |
| `displayName` | Human-readable name shown in the cache backend selector. |
| `description` | Optional one-line description shown next to the selector. |
| `configVersion` | Current version of the plugin's `configSchema`. Increment when changing the schema in a non-additive way. |
| `configSchema` | Zod schema validating the operator-supplied configuration. The Cache Configuration tab renders form controls from this schema. |
| `migrations` | Optional list of `Migration` objects allowing old persisted configs to be upgraded to the latest version. |
| `createProvider(config, logger)` | Build and return a fresh provider for the given config. Called once per `setActiveBackend`. |

The `InMemoryCachePlugin` ([plugins/cache-memory-backend/src/plugin.ts](../../plugins/cache-memory-backend/src/plugin.ts)) is the canonical example: ~30 lines, two configurable fields (`maxEntries`, `sweepIntervalMs`).

### Authoring a New Cache Backend

> [!NOTE]
> A Redis backend already ships as `plugins/cache-redis-backend` - select it in the Infrastructure Configuration UI rather than writing your own. The example below is the general recipe for any other distributed store (Memcached, a managed KV, ...). For a real distributed provider, read [plugins/cache-redis-backend/src/redis-cache.ts](../../plugins/cache-redis-backend/src/redis-cache.ts): note that it serializes values with `v8.serialize` rather than JSON so `Date`/`Map`/`Set` survive the round trip (several cached payloads carry `Date`s that JSON would flatten to strings), and reports `scope: "cluster"` from `getStats` so the UI can flag which caches are shared.

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
- **Active sweep** - a background timer periodically removes expired entries.
- **LRU-style capacity limits** - oldest entries (by insertion order) are evicted when `maxEntries` is reached.

Configuration:

| Field | Default | Purpose |
|---|---|---|
| `maxEntries` | `10_000` | Maximum number of cache entries before insertion-order eviction kicks in. |
| `sweepIntervalMs` | `60_000` | Background sweep interval. Set to `0` to disable active sweeping. |

This backend is appropriate for single-instance deployments and the dev environment. For multi-instance clusters, select the shipped Redis backend (or another distributed plugin) in the Infrastructure Configuration UI - see the next section.

## Distributed caching and horizontal scale

The cache is not just a convenience for individual plugins - several **platform caches** sit on the hot request path and rely on the active backend for cross-pod coherence:

- **System health status** (`healthcheck-backend`): the per-`(system, environment)` derived status behind dashboard badges, the bulk status endpoint, the dependency-map matrix, and the AI signals scan.
- **Auth read path** (`auth-backend` + `core/backend`): `user -> role ids`, `role -> access-rule ids`, and the anonymous role's effective rules - resolved on essentially every authenticated (and every public) request.

These caches are read-through with change-gated invalidation on mutation. Crucially, **their cross-pod coherence comes entirely from the active cache backend, not from any application-level broadcast**: an invalidation is a `delete` on the shared store, and a value written or deleted by one pod is immediately visible to all pods that share it.

That design has a hard operational consequence:

> [!CAUTION]
> The default in-memory backend is **per-pod**. Under horizontal scale it gives each pod its OWN cache, so a mutation on pod A does not evict pod B's entry, and a user load-balanced to pod B can see a stale authorization decision or health status until the short TTL expires. **If you run more than one pod, you MUST select a distributed backend (Redis).** With Redis, every pod shares one store, so an invalidation is seen everywhere at once and the caches stay coherent.

Why a distributed cache rather than pod-local caches kept coherent by an event-bus broadcast? Because the platform already runs a shared cache: reusing it means one coherence mechanism (a `delete` on the shared store) instead of two (a per-pod cache PLUS a broadcast to invalidate it), no broadcast-drop edge cases, and a read that is still far cheaper than the DB query it replaces - a cache `GET` is sub-millisecond, non-blocking, and does not consume a database connection. The trade-off is a network round-trip to the cache on a miss, which is the standard pattern for session/permission data in horizontally-scaled applications.

The residual race - an in-flight loader that writes just after a concurrent `delete` - is bounded by the entry TTL (15s for health status, 60s for the auth caches), the same bound the broadcast design had. TTL is a safety net here, never the primary invalidation mechanism.

When you add a query-heavy read path, prefer indexes plus this shared cache over inventing a new pod-local cache; a pod-local cache reintroduces the per-pod staleness this section warns about. See the repository rule `.claude/rules/optimization.md`.

## Configuration UI

The cache backend is configured through the Cache tab of the Infrastructure Configuration page - see [Infrastructure Configuration](/checkstack/developer-guide/frontend/infrastructure-config/).

## Related Documentation

- [Queue System](/checkstack/developer-guide/backend/queue-system/) - sibling pattern, more sophisticated lifecycle.
- [Plugin Architecture](/checkstack/developer-guide/architecture/plugin-system/) - overall plugin model.
- [Infrastructure Configuration](/checkstack/developer-guide/frontend/infrastructure-config/) - the UI that hosts the Cache tab.
