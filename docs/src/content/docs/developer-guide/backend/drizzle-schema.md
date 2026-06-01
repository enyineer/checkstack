---
title: "Drizzle Schema Isolation"
description: "Per-plugin Postgres schema isolation, how the loader sets search_path, and how to define tables in your plugin."
---

## Overview

Each plugin in Checkstack has its own isolated database schema (e.g., `plugin_catalog`, `plugin_auth`). This ensures plugins don't conflict with each other and allows for clean separation of concerns.

## How It Works

Plugins define tables using Drizzle's `pgTable()` function. At runtime, the plugin loader sets `search_path` on each plugin's database connection to route queries to the correct schema.

```typescript
// plugins/my-feature-backend/src/schema.ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Define tables using pgTable (no schema prefix needed)
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

## Generated Migrations

When you run `bun run generate`, Drizzle produces **schema-agnostic** migrations:

```sql
CREATE TABLE "items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
```

At runtime, the plugin's `search_path` ensures tables are created in the correct schema (e.g., `plugin_my_feature`).

The loader runs each plugin's migrations on a **single pinned connection**
checked out from the shared admin pool, with a **strict** `search_path =
"plugin_{id}"` (no `public` fallback). The plugin schema is created first, so
unqualified `CREATE TABLE` / `CREATE TYPE` statements can only ever land in the
plugin schema - never `public`.

It sets `search_path` on the pinned connection (rather than at the session level
on the shared pool) for the same connection-affinity reason that applies to
[session advisory locks](#advisory-locks): `migrate()` runs its statements
inside a transaction that the pool may service on a different physical
connection than a session-level `SET` ran on.

### Relocating legacy `public` objects

Some databases predate per-plugin schema isolation and have a plugin's tables
and enums sitting in `public` (runtime kept working because the scoped-db
search_path falls back to `public`). A strict migration search_path would not
find them, so before migrating, the loader **moves** any of the plugin's
objects still in `public` into `plugin_{id}` with fully-qualified
`ALTER ... SET SCHEMA` statements. The move is by-OID (columns, foreign keys,
enum references, and owned sequences keep working) and idempotent (an object is
moved only if it is in `public` and not already in the plugin schema), so fresh
and already-migrated installs are no-ops.

The set of objects to relocate is the **union of every Drizzle snapshot** under
the plugin's `drizzle/meta/`, not just the latest - so a table an early
migration created and a later one drops is moved into the plugin schema first,
letting its unqualified `DROP TABLE` resolve under the strict search_path.

> [!WARNING]
> Do not reintroduce a `public` fallback in the migration `search_path` to
> "fix" an object that lives in `public`. That lets a future `CREATE TABLE`
> silently land in `public` whenever the plugin schema is missing or empty.
> Relocate the stray object into the plugin schema instead.

## Migration Tracking

> [!IMPORTANT]
> Each plugin's migrations are tracked in its own `plugin_{id}.__drizzle_migrations` table. This is configured automatically by the plugin loader using the `migrationsSchema` option.

This per-plugin tracking ensures:
- Migrations for plugin A don't affect plugin B
- Each plugin's migration history is isolated
- Baseline regeneration for one plugin doesn't impact others

## Plugin Renames

Plugins can specify `previousPluginIds` in their metadata to safely rename:

```typescript
export const pluginMetadata = definePluginMetadata({
  pluginId: "new-feature-name",
  previousPluginIds: ["old-feature-name"], // Old schema renamed automatically
});
```

When the plugin loads, the database factory automatically renames the old schema (`plugin_old_feature_name`) to the new one (`plugin_new_feature_name`) before migrations run.

## Dependencies

Backend plugins with database schemas need:

```json
{
  "dependencies": {
    "@checkstack/common": "workspace:*",
    "drizzle-orm": "^0.45.1"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.8"
  }
}
```

## Schema Naming Convention

Schema names follow the pattern `plugin_{pluginId}`:

- `pluginId: "catalog"` → schema `plugin_catalog`
- `pluginId: "auth"` → schema `plugin_auth`
- `pluginId: "my-feature"` → schema `plugin_my_feature`

> **Note**: Hyphens in plugin IDs are converted to underscores for valid PostgreSQL schema names.

## SafeDatabase Type

Plugin database interactions should use `SafeDatabase<S>` instead of `NodePgDatabase<S>`:

```typescript
import type { SafeDatabase } from "@checkstack/backend-api";
import type * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;
```

**Why SafeDatabase?**

Drizzle's `NodePgDatabase` includes a `query` property for the [Relational Query API](https://orm.drizzle.team/docs/rqb). However, this API bypasses PostgreSQL's `search_path` mechanism and can access tables in other schemas, which breaks plugin isolation.

The platform's scoped database proxy **blocks relational queries at runtime** and throws an error. `SafeDatabase` prevents this at **compile-time** by omitting the `query` property:

```typescript
// SafeDatabase is just NodePgDatabase without 'query'
type SafeDatabase<S> = Omit<NodePgDatabase<S>, "query">;
```

**Blocked API:**

```typescript
// ❌ This will fail at runtime (blocked by scoped database proxy)
const config = await db.query.items.findFirst({
  where: eq(items.id, id),
});
```

**Recommended Pattern:**

```typescript
// ✅ Use standard select queries
const [config] = await db
  .select()
  .from(items)
  .where(eq(items.id, id))
  .limit(1);
```

## Advisory locks

Each plugin query runs through the scoped database proxy, which wraps every
statement in its own short transaction on a connection borrowed from the
shared pool and returned immediately. That breaks Postgres **session-level**
advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock`): the acquire
and the release run on different pooled connections, so the unlock no-ops and
the lock leaks. Do NOT call the session-lock functions through the scoped
`db`.

Use the `coreServices.advisoryLock` service instead. It checks out one
dedicated client from a **separate lock pool** (NOT the shared admin pool),
acquires the session lock on it, and returns a handle whose `release()` runs
the unlock on the SAME client before returning it to the pool. Use it for
locks held for a long time (e.g. an election held across a slow background
job), where a long-open transaction would be unacceptable:

```typescript
import { coreServices } from "@checkstack/backend-api";

env.registerInit({
  deps: { advisoryLock: coreServices.advisoryLock },
  init: async ({ advisoryLock }) => {
    const lock = await advisoryLock.tryAcquire("my-plugin.some-election");
    if (!lock) return; // another instance holds it
    try {
      await doTheLongRunningWork();
    } finally {
      await lock.release();
    }
  },
});
```

Keys are arbitrary strings hashed into Postgres' global 64-bit lock space, so
namespace them per plugin (e.g. `"my-plugin.<purpose>"`).

For a SHORT critical section, prefer `advisoryLock.withXactLock`, which wraps
acquire + work + release using `pg_advisory_xact_lock` (it auto-releases at
COMMIT, so a leak is impossible). The lock transaction runs on the **dedicated
lock pool**, while `fn` does its work on the admin pool as usual:

```typescript
await advisoryLock.withXactLock({
  key: `my-plugin.dedupe:${someId}`,
  fn: async () => {
    // find-then-create, serialized per key (runs on the admin-pool `db`)
  },
});
```

> [!CAUTION]
> Why two pools? A held advisory lock keeps its connection checked out for the
> lock's whole lifetime while the gated work runs on a *different* connection.
> If both came from one pool, then at concurrency >= pool size every slot
> becomes a lock-holder waiting for a work connection that can never free up -
> a self-inflicted deadlock that surfaces as connections stuck `idle in
> transaction` on `pg_advisory_xact_lock` and every request hanging into a 502.
> Drawing lock connections from a separate pool makes the acquire graph acyclic
> (`lockPool -> adminPool`, never back), so that class of deadlock is
> impossible. Always go through `coreServices.advisoryLock`; never run an
> advisory lock through a plugin's scoped `db`.

### What if a critical section stalls?

Advisory locks lock **no rows or tables** - other queries against the same
tables run untouched. Only other callers of the **same key** block. But a
critical section whose `fn` hangs (an unbounded await) would otherwise hold its
key, and its lock-pool connection, open forever. Two server-enforced backstops
on the lock pool bound that (they can't be skipped by a stuck process):

- `idle_in_transaction_session_timeout` (`DATABASE_LOCK_IDLE_TX_TIMEOUT_MS`,
  default 30s): the lock transaction sits idle-in-transaction for the whole
  time `fn` runs, so a hang past this aborts the session - auto-releasing the
  lock and freeing the connection. The stall self-heals.
- `lock_timeout` (`DATABASE_LOCK_TIMEOUT_MS`, default 30s): a caller blocked
  waiting on a contended or stalled key aborts with a retryable error instead
  of blocking (and tying up a connection) indefinitely.

A crash or pod restart also ends the holding transaction, which auto-releases
the lock - so a stalled lock can never survive the process that held it. Keep
critical sections SHORT (a read-then-write); never do unbounded external work
(HTTP, etc.) inside one.

### Connection budget

The platform runs as N pods sharing one Postgres, so size both pools off
`max_connections`, NOT the plugin count (connections are never pinned
per-plugin - the scoped proxy borrows and returns one per transaction):

```text
N_pods * (DATABASE_POOL_MAX + DATABASE_LOCK_POOL_MAX) <= max_connections - headroom
```

Both pools also set `connectionTimeoutMillis` (`DATABASE_POOL_CONNECTION_TIMEOUT_MS`,
default 10s) so an exhausted pool fails fast and self-heals instead of hanging
forever. Tunable env vars: `DATABASE_POOL_MAX` (default 20),
`DATABASE_LOCK_POOL_MAX` (default 10), `DATABASE_POOL_IDLE_TIMEOUT_MS`
(default 30s).

## See Also

- [Backend Plugins](/checkstack/developer-guide/backend/plugins/)
- [Plugin Templates](/checkstack/developer-guide/examples/plugin-templates/)
