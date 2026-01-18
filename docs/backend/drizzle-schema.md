---
---
# Drizzle Schema Isolation

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

## See Also

- [Backend Plugins](./plugins.md)
- [Plugin Templates](../examples/plugin-templates.md)
