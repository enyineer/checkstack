---
---
# Versioned Data System

## Overview

The versioned data system enables **backward-compatible schema evolution** for plugin configurations and data. As your plugin evolves, you can change schemas without breaking existing deployments.

## Why Versioned Data?

### The Problem

Without versioning:
- Changing a schema breaks existing stored data
- Users must manually update all configs when upgrading
- No way to track what version data was created with
- Difficult to maintain backward compatibility

### The Solution

The `Versioned<T>` class provides:
- **Automatic migrations** from old to new schema versions
- **Backward compatibility** across plugin updates
- **Audit trail** of when data was migrated
- **Type safety** throughout the migration process
- **Unified API** for parsing, validating, and creating versioned data

## Core Concepts

### Versioned<T> Class

The unified API for handling versioned data:

```typescript
import { Versioned, z } from "@checkmate/backend-api";

// Define your versioned type
const configType = new Versioned({
  version: 2,
  schema: configSchemaV2,
  migrations: [v1ToV2Migration],
});

// Parse stored data (auto-migrates and validates)
const config = await configType.parse(storedRecord);

// Create new versioned data
const record = configType.create({ url: "...", method: "GET" });
```

### VersionedRecord<T>

A simple interface for versioned data stored in the database:

```typescript
interface VersionedRecord<T> {
  /** Schema version of this record */
  version: number;
  /** The actual data payload */
  data: T;
  /** When the last migration was applied (if any) */
  migratedAt?: Date;
  /** Original version before any migrations were applied */
  originalVersion?: number;
}
```

### VersionedPluginRecord<T>

Extends `VersionedRecord` with plugin context:

```typescript
interface VersionedPluginRecord<T> extends VersionedRecord<T> {
  /** Plugin ID that owns this configuration */
  pluginId: string;
}
```

### Migration

A function that transforms data from one version to the next:

```typescript
interface Migration<TFrom, TTo> {
  /** Version this migration upgrades FROM */
  fromVersion: number;
  /** Version this migration upgrades TO (must be fromVersion + 1) */
  toVersion: number;
  /** Human-readable description */
  description: string;
  /** Migration function */
  migrate: (data: TFrom) => TTo | Promise<TTo>;
}
```

## Basic Usage

### 1. Define Your Schema

```typescript
import { z } from "zod";

export const httpCheckConfigSchema = z.object({
  url: z.string().url(),
  timeout: z.number().default(5000),
  method: z.enum(["GET", "POST", "HEAD"]).default("GET"),
});

export type HttpCheckConfig = z.infer<typeof httpCheckConfigSchema>;
```

### 2. Create a Versioned Type

```typescript
import { Versioned } from "@checkmate/backend-api";

export const httpCheckConfig = new Versioned<HttpCheckConfig>({
  version: 1,
  schema: httpCheckConfigSchema,
  migrations: [], // No migrations yet for v1
});
```

### 3. Use in Health Check Strategy

```typescript
export class HttpHealthCheckStrategy
  implements HealthCheckStrategy<HttpCheckConfig, HttpResult, HttpAggregated>
{
  id = "http";
  displayName = "HTTP Health Check";
  
  // Use Versioned instance for type-safe schema handling
  config: Versioned<HttpCheckConfig> = new Versioned({
    version: 1,
    schema: httpCheckConfigSchema,
  });
  
  async execute(config: HttpCheckConfig) {
    // Implementation
  }
}
```

### 4. Create and Parse Data

```typescript
// Create new versioned data
const record = httpCheckConfig.create({
  url: "https://example.com",
  timeout: 5000,
  method: "GET",
});

// Store in database
await db.insert(configs).values({ data: record });

// Later: load and parse (auto-migrates if needed)
const storedRecord = await db.select().from(configs).where(...);
const config = await httpCheckConfig.parse(storedRecord.data);
```

## Schema Evolution

### Adding a New Field

**Version 1:**
```typescript
const configV1 = z.object({
  url: z.string().url(),
  timeout: z.number(),
});
```

**Version 2:** Add `method` field
```typescript
const configV2 = z.object({
  url: z.string().url(),
  timeout: z.number(),
  method: z.enum(["GET", "POST", "HEAD"]),
});
```

### Create Migration

```typescript
const v1ToV2: Migration<ConfigV1, ConfigV2> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Add HTTP method field",
  migrate: (data) => ({
    ...data,
    method: "GET", // Default for existing configs
  }),
};
```

### Update Versioned Type

```typescript
export const httpCheckConfig = new Versioned<ConfigV2>({
  version: 2,
  schema: configV2,
  migrations: [v1ToV2],
});
```

## Migration Chains

When you have multiple schema versions:

```typescript
// V1 -> V2: Add method
const v1ToV2: Migration<ConfigV1, ConfigV2> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Add HTTP method",
  migrate: (data) => ({ ...data, method: "GET" }),
};

// V2 -> V3: Add headers
const v2ToV3: Migration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  description: "Add headers support",
  migrate: (data) => ({ ...data, headers: {} }),
};

// V3 -> V4: Rename timeout to timeoutMs
const v3ToV4: Migration<ConfigV3, ConfigV4> = {
  fromVersion: 3,
  toVersion: 4,
  description: "Rename timeout to timeoutMs",
  migrate: (data) => ({
    url: data.url,
    method: data.method,
    headers: data.headers,
    timeoutMs: data.timeout,
  }),
};

// Register all migrations
export const httpCheckConfig = new Versioned<ConfigV4>({
  version: 4,
  schema: configV4,
  migrations: [v1ToV2, v2ToV3, v3ToV4],
});
```

### Type-Safe Migration Builder

For better type inference:

```typescript
import { MigrationBuilder } from "@checkmate/backend-api";

const migrations = new MigrationBuilder<ConfigV1>()
  .addMigration<ConfigV2>({
    fromVersion: 1,
    toVersion: 2,
    description: "Add method",
    migrate: (data) => ({ ...data, method: "GET" }),
  })
  .addMigration<ConfigV3>({
    fromVersion: 2,
    toVersion: 3,
    description: "Add headers",
    migrate: (data) => ({ ...data, headers: {} }),
  })
  .build();
```

## Versioned<T> API Reference

### Parsing (Load from Storage)

```typescript
// Parse and migrate - returns just the data
const data = await versioned.parse(storedRecord);

// Safe parse - returns result object
const result = await versioned.safeParse(storedRecord);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}

// Parse and return full record (preserves metadata)
const record = await versioned.parseRecord(storedRecord);
console.log(record.version, record.data, record.migratedAt);
```

### Creating (Wrap New Data)

```typescript
// Create a VersionedRecord
const record = versioned.create({ url: "...", method: "GET" });
// Result: { version: 2, data: { url: "...", method: "GET" } }

// Create with plugin context
const pluginRecord = versioned.createForPlugin(
  { url: "...", method: "GET" },
  "my-plugin"
);
// Result: { version: 2, data: {...}, pluginId: "my-plugin" }
```

### Utilities

```typescript
// Check if migration is needed
if (versioned.needsMigration(storedRecord)) {
  console.log("Data needs migration");
}

// Validate data without migration
const validated = versioned.validate(rawData);

// Safe validate
const result = versioned.safeValidate(rawData);
```

## Best Practices

### 1. Never Skip Versions

Always increment version by 1:

```typescript
// ✅ Good
version: 1 -> 2 -> 3 -> 4

// ❌ Bad
version: 1 -> 3 -> 5
```

### 2. Provide Sensible Defaults

When adding required fields:

```typescript
migrate: (data) => ({
  ...data,
  newRequiredField: "default-value",
})
```

### 3. Document Breaking Changes

```typescript
// V2 -> V3: BREAKING: Changed timeout from seconds to milliseconds
const v2ToV3: Migration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  description: "Convert timeout from seconds to milliseconds",
  migrate: (data) => ({
    ...data,
    timeout: data.timeout * 1000,
  }),
};
```

### 4. Test Migrations

```typescript
import { describe, expect, test } from "bun:test";

describe("Config Migrations", () => {
  test("migrates V1 to V2", () => {
    const v1: ConfigV1 = { url: "https://example.com", timeout: 5000 };
    const v2 = v1ToV2.migrate(v1);
    
    expect(v2).toEqual({
      url: "https://example.com",
      timeout: 5000,
      method: "GET",
    });
  });

  test("migrates V1 to V4 through chain", async () => {
    const storedV1: VersionedRecord<ConfigV1> = {
      version: 1,
      data: { url: "https://example.com", timeout: 5 },
    };

    const migrated = await httpCheckConfig.parseRecord(storedV1);

    expect(migrated.version).toBe(4);
    expect(migrated.data.timeoutMs).toBe(5000);
    expect(migrated.originalVersion).toBe(1);
  });
});
```

### 5. Keep Old Schemas

Don't delete old schema definitions—you need them for type safety in migrations:

```typescript
// Keep all versions for reference
export const configV1 = z.object({ /* ... */ });
export const configV2 = z.object({ /* ... */ });
export const configV3 = z.object({ /* ... */ });
export const configV4 = z.object({ /* ... */ }); // Current

export type ConfigV1 = z.infer<typeof configV1>;
export type ConfigV2 = z.infer<typeof configV2>;
export type ConfigV3 = z.infer<typeof configV3>;
export type ConfigV4 = z.infer<typeof configV4>;
```

## Async Migrations

Migrations can be async for complex transformations:

```typescript
const v2ToV3: Migration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  description: "Enrich with external metadata",
  migrate: async (data) => {
    const metadata = await fetchMetadata(data.url);
    return { ...data, metadata };
  },
};
```

## Troubleshooting

### Migration Not Running

Check that:
1. Migration `fromVersion` and `toVersion` are correct
2. Migrations are included in the `migrations` array
3. `version` matches the latest target version

### Type Errors

Ensure:
1. Migration input/output types match schema versions
2. All schema versions are exported
3. Migration chain types are correct

### Data Loss

Always:
1. Test migrations with production data samples
2. Keep backups before upgrading
3. Validate migrated data

## Next Steps

- [Backend Plugin Development](./plugins.md)
- [Health Check System](./healthcheck-data-management.md)
- [Contributing Guide](../getting-started/contributing.md)
