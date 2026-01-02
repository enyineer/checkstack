---
---
# Drizzle Schema Isolation

## Overview

Each plugin in Checkmate has its own isolated database schema (e.g., `plugin_catalog`, `plugin_auth`). This ensures plugins don't conflict with each other and allows for clean separation of concerns.

## How It Works

Plugins use Drizzle's `pgSchema()` function combined with the `getPluginSchemaName()` helper to define schema-qualified tables:

```typescript
// plugins/my-feature-backend/src/schema.ts
import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgSchema } from "drizzle-orm/pg-core";
import { getPluginSchemaName } from "@checkmate/drizzle-helper";
import { pluginMetadata } from "./plugin-metadata";

// Create plugin-scoped schema
const myFeatureSchema = pgSchema(getPluginSchemaName(pluginMetadata.pluginId));

// Define tables using the schema
export const items = myFeatureSchema.table("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

## Generated Migrations

When you run `bun run generate`, Drizzle produces migrations with **explicit schema prefixes**:

```sql
CREATE TABLE "plugin_my_feature"."items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
```

This ensures tables are always created in the correct schema, regardless of the database connection's `search_path`.

## Migration Tracking

> [!IMPORTANT]
> Each plugin's migrations are tracked in its own `plugin_{id}.__drizzle_migrations` table. This is configured automatically by the plugin loader using the `migrationsSchema` option when calling Drizzle's `migrate()` function.

This per-plugin tracking ensures:
- Migrations for plugin A don't affect plugin B
- Each plugin's migration history is isolated
- Baseline regeneration for one plugin doesn't impact others

## Plugin Metadata Pattern

Every backend plugin must define its metadata in a separate file:

```typescript
// plugins/my-feature-backend/src/plugin-metadata.ts
import { definePluginMetadata } from "@checkmate/common";

export const pluginMetadata = definePluginMetadata({
  pluginId: "my-feature",
});
```

This metadata is used by:
- `createBackendPlugin()` for plugin registration
- `getPluginSchemaName()` for database schema naming
- Permission prefixing
- RPC router mounting

## Dependencies

Backend plugins with database schemas need:

```json
{
  "dependencies": {
    "@checkmate/common": "workspace:*",
    "drizzle-orm": "^0.36.4"
  },
  "devDependencies": {
    "@checkmate/drizzle-helper": "workspace:*",
    "drizzle-kit": "^0.28.1"
  }
}
```

## Schema Naming Convention

The `getPluginSchemaName()` helper generates schema names using the pattern:

```
plugin_{pluginId}
```

For example:
- `pluginId: "catalog"` → schema `plugin_catalog`
- `pluginId: "auth"` → schema `plugin_auth`
- `pluginId: "my-feature"` → schema `plugin_my_feature`

> **Note**: Hyphens in plugin IDs are converted to underscores for valid PostgreSQL schema names.

## See Also

- [Backend Plugins](./plugins.md)
- [Plugin Templates](../examples/plugin-templates.md)
