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
dedicated client from the pool, acquires the session lock on it, and returns
a handle whose `release()` runs the unlock on the SAME client before
returning it to the pool. Use it for locks held for a long time (e.g. an
election held across a slow background job), where a long-open transaction
would be unacceptable:

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

For a SHORT critical section, prefer `withXactLock`, which wraps acquire +
work + release in a single transaction using `pg_advisory_xact_lock` (it
auto-releases at COMMIT, so a leak is impossible). Because the scoped DB runs
a whole `transaction()` callback on one connection, the lock and the work
share a session:

```typescript
import { withXactLock } from "@checkstack/backend-api";

await withXactLock({
  db,
  key: `my-plugin.dedupe:${someId}`,
  fn: async () => {
    // find-then-create, serialized per key
  },
});
```

## See Also

- [Backend Plugins](/checkstack/developer-guide/backend/plugins/)
- [Plugin Templates](/checkstack/developer-guide/examples/plugin-templates/)
