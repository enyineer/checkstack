---
---
# Plugin Configuration Storage

## Overview

Plugins need to store two types of data:
1. **Plugin-level configuration** - Settings that control how the plugin behaves
2. **User data/entities** - Content created and managed by users

This guide explains when to use ConfigService (for config) vs custom Drizzle schemas (for data).

## Quick Decision Tree

```
Is this data used to configure/control plugin behavior?
  ├─ YES → Use ConfigService
  │   Examples: Active queue provider, enabled auth strategies, plugin settings
  │
  └─ NO → Is this user-created content?
      └─ YES → Use custom Drizzle schema
          Examples: Health check instances, catalog systems, user-created items
```

## ConfigService: For Plugin Configuration

### What is ConfigService?

`ConfigService` provides centralized, type-safe storage for **plugin-level configuration** with automatic secret encryption and schema migration support.

### When to Use ConfigService

Use ConfigService when storing:
- ✅ Plugin behavior settings (e.g., which queue provider to use)
- ✅ Strategy/provider selections (e.g., active auth strategies)
- ✅ Plugin-level toggles and preferences
- ✅ **Especially**: Any config containing secrets (API keys, tokens, passwords)

**Key indicator:** The data controls **how the plugin operates**, not what content it manages.

### Example: Queue Configuration

```typescript
import { coreServices, type ConfigService } from "@checkmate/backend-api";
import { z } from "zod";

// Schema for queue config
const queueConfigSchema = z.object({
  pluginId: z.string(), // "memory", "bullmq", etc.
  config: z.record(z.string(), z.unknown()),
});

export default createBackendPlugin({
  pluginId: "backend",
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.config, // Inject ConfigService
        queueManager: coreServices.queueManager,
      },
      init: async ({ config, queueManager }) => {
        // Load active queue provider configuration
        const queueConfig = await config.get(
          "active",
          queueConfigSchema,
          1
        );

        if (queueConfig) {
          await queueManager.setActiveBackend(
            queueConfig.pluginId,
            queueConfig.config
          );
        }
      },
    });
  },
});
```

### ConfigService API

**`config.get(configId, schema, version, migrations?)`**

Load a configuration:
```typescript
const strategy = await config.get(
  "github",
  githubStrategySchema,
  1,
  migrations
);

if (strategy?.enabled) {
  // Use the strategy
}
```

**`config.getRedacted(configId, schema, version, migrations?)`**

Load configuration with secrets removed (safe for frontend):
```typescript
const redacted = await config.getRedacted(
  "github",
  githubStrategySchema,
  1
);
// redacted.clientSecret is undefined
```

**`config.set(configId, schema, version, data)`**

Save a configuration:
```typescript
await config.set(
  "github",
  githubStrategySchema,
  1,
  {
    clientId: "abc123",
    clientSecret: "secret", // Automatically encrypted!
    enabled: true,
  }
);
```

**`config.delete(configId)`**

Delete a configuration:
```typescript
await config.delete("github");
```

**`config.list()`**

List all configurations for this plugin:
```typescript
const configs = await config.list();
// Returns: [{ configId: "github", updatedAt: Date }, ...]
```

### Secret Handling

ConfigService automatically encrypts/decrypts secrets marked with `z.secret()`:

```typescript
import { secret } from "@checkmate/backend-api";

const githubStrategySchema = z.object({
  clientId: z.string(),
  clientSecret: secret(z.string()), // Marked as secret
  enabled: z.boolean(),
});

// When you save:
await config.set("github", schema, 1, {
  clientId: "abc123",
  clientSecret: "my-secret", // Stored encrypted in database
  enabled: true,
});

// When you load:
const strategy = await config.get("github", schema, 1);
// strategy.clientSecret = "my-secret" (decrypted automatically)

// When frontend loads:
const redacted = await config.getRedacted("github", schema, 1);
// redacted.clientSecret is undefined (removed)
```

### Schema Versioning

ConfigService supports schema migrations (see [Versioned Configurations](./versioned-configs.md)):

```typescript
const migrations = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (data: V1) => ({ ...data, newField: "default" }),
  },
];

// Old configs are automatically migrated when loaded
const config = await configService.get("github", schemaV2, 2, migrations);
```

## Custom Drizzle Schemas: For User Data

### When to Use Custom Schemas

Use custom Drizzle schemas when storing:
- ✅ User-created entities (health checks, catalog systems, etc.)
- ✅ User content (incidents, maintenance windows, etc.)
- ✅ Relational data with foreign keys
- ✅ Data that users CRUD via the UI
- ✅ Historical data (health check runs, audit logs)

**Key indicator:** The data is **content managed by users**, not settings that control the plugin.

### Example: Health Check Instances

```typescript
// src/schema.ts
export const healthCheckConfigurations = pgTable("health_check_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  strategyId: text("strategy_id").notNull(), // "http", "ping", etc.
  config: jsonb("config").notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// These are USER-CREATED health check instances
// Examples: "Check example.com homepage", "Ping database server"
// NOT plugin configuration
```

### Why Not ConfigService for Entities?

ConfigService is optimized for:
- Plugin-level settings (one active config per plugin)
- Automatic secret encryption
- Schema migrations

But entities need:
- Many instances per plugin (hundreds of health checks)
- Complex foreign key relationships
- Efficient querying and pagination
- User-friendly CRUD operations

**Custom schemas are the right choice for user data.**

## Comparison Table

| Aspect | ConfigService | Custom Drizzle Schema |
|--------|---------------|----------------------|
| **Purpose** | Plugin behavior settings | User-created content |
| **Scope** | Plugin-level | User-level |
| **Cardinality** | One or few per plugin | Many instances |
| **Secrets** | Automatic encryption | Manual if needed |
| **Migrations** | Built-in versioning | Drizzle migrations |
| **Queries** | Simple get/set by ID | Complex SQL queries |
| **UI** | Settings pages | CRUD interfaces |
| **Examples** | Queue provider, auth strategies | Health checks, systems, users |

## Real-World Examples

### ✅ ConfigService Examples

**Auth Backend** - Strategy configurations:
```typescript
// Stores: "Which auth strategies are enabled?"
await config.set("github", githubSchema, 1, {
  clientId: "...",
  clientSecret: secret("..."),
  enabled: true,
});
```

**Queue Backend** - Active provider:
```typescript
// Stores: "Which queue provider is active?"
await config.set("active", queueSchema, 1, {
  pluginId: "bullmq",
  config: { redis: { host: "localhost" } },
});
```

**Auth Backend** - Platform Registration Settings:
```typescript
// Controls whether new user registration is allowed platform-wide.
// When disabled, only existing users can sign in - useful for private deployments.
const platformRegistrationConfigV1 = z.object({
  allowRegistration: z
    .boolean()
    .default(true)
    .describe(
      "When enabled, new users can create accounts. When disabled, only existing users can sign in."
    ),
});

// The schema's describe() is automatically shown in DynamicForm settings UI
await config.set("platform.registration", platformRegistrationConfigV1, 1, {
  allowRegistration: false, // Lock down registration
});
```

### ✅ Custom Schema Examples

**Health Check Backend** - Check instances:
```typescript
// Many user-created health checks
export const healthCheckConfigurations = pgTable(/* ... */);
// Examples: "API health", "DB ping", "Homepage check"
```

**Catalog Backend** - Systems and groups:
```typescript
// User-managed catalog entities
export const systems = pgTable(/* ... */);
export const groups = pgTable(/* ... */);
```

## Migration Guide

If you're currently using custom tables for plugin config, migrate to ConfigService:

### Before (Custom Table):
```typescript
// ❌ Old: Custom table for plugin config
export const authStrategy = pgTable("auth_strategy", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled"),
  config: jsonb("config"),
});

// Manual encryption/decryption required
```

### After (ConfigService):
```typescript
// ✅ New: Use ConfigService
await config.set("github", schema, 1, {
  clientId: "...",
  clientSecret: secret("..."), // Auto-encrypted
  enabled: true,
});

// Drop old table in migration
DROP TABLE IF EXISTS "auth_strategy";
```

## Best Practices

### 1. Use ConfigService for Plugin Settings
```typescript
// ✅ Good: Plugin behavior config
await config.set("active-theme", themeSchema, 1, { theme: "dark" });
```

### 2. Use Custom Schema for User Content
```typescript
// ✅ Good: User-created entities
await db.insert(healthChecks).values({
  name: "API Health Check",
  url: "https://api.example.com",
});
```

### 3. Mark Secrets in Schemas
```typescript
// ✅ Good: Explicit secret marking
const schema = z.object({
  apiKey: secret(z.string()),
  apiUrl: z.string().url(),
});
```

### 4. Don't Store Secrets in Custom Schemas
```typescript
// ❌ Bad: Storing secrets without encryption
export const integrations = pgTable("integrations", {
  apiKey: text("api_key"), // Not encrypted!
});

// ✅ Good: Use ConfigService for secrets
await config.set("slack-integration", schema, 1, {
  webhookUrl: secret("https://..."),
});
```

## Next Steps

- [Backend Plugin Development](./plugins.md)
- [Versioned Configurations](./versioned-configs.md)
- [Extension Points](../frontend/extension-points.md)
