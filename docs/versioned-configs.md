# Versioned Configuration System

## Overview

The versioned configuration system enables **backward-compatible schema evolution** for plugin configurations. As your plugin evolves, you can change configuration schemas without breaking existing deployments.

## Why Versioned Configs?

### The Problem

Without versioning:
- Changing a config schema breaks existing configurations
- Users must manually update all configs when upgrading
- No way to track what version a config was created with
- Difficult to maintain backward compatibility

### The Solution

Versioned configs provide:
- **Automatic migrations** from old to new schema versions
- **Backward compatibility** across plugin updates
- **Audit trail** of when configs were migrated
- **Type safety** throughout the migration process

## Core Concepts

### VersionedConfig

A wrapper around your configuration data:

```typescript
interface VersionedConfig<T> {
  /** Schema version (starts at 1, increments sequentially) */
  version: number;

  /** Plugin ID that owns this configuration */
  pluginId: string;

  /** The actual configuration data */
  data: T;

  /** When the last migration was applied (if any) */
  migratedAt?: Date;

  /** Original version before any migrations were applied */
  originalVersion?: number;
}
```

### ConfigMigration

A function that transforms config from one version to the next:

```typescript
interface ConfigMigration<TFrom, TTo> {
  /** Version this migration upgrades FROM */
  fromVersion: number;

  /** Version this migration upgrades TO */
  toVersion: number;

  /** Migration function */
  migrate: (data: TFrom) => TTo | Promise<TTo>;
}
```

### MigrationChain

An ordered list of migrations:

```typescript
type MigrationChain<T> = ConfigMigration<unknown, unknown>[];
```

## Basic Usage

### 1. Define Your Config Schema

```typescript
import { z } from "zod";

// Version 1 schema
export const httpCheckConfigV1 = z.object({
  url: z.string().url(),
  timeout: z.number().default(5000),
});

export type HttpCheckConfigV1 = z.infer<typeof httpCheckConfigV1>;
```

### 2. Use in Extension Point

```typescript
import { HealthCheckStrategy } from "@checkmate/backend-api";

export const httpHealthCheckStrategy: HealthCheckStrategy<HttpCheckConfigV1> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  configVersion: 1, // Current version
  configSchema: httpCheckConfigV1,
  
  async execute(config: HttpCheckConfigV1) {
    // Implementation
  },
};
```

### 3. Store Versioned Config

```typescript
const versionedConfig: VersionedConfig<HttpCheckConfigV1> = {
  version: 1,
  pluginId: "healthcheck-http-backend",
  data: {
    url: "https://example.com",
    timeout: 5000,
  },
};

// Store in database as JSON
await db.insert(healthChecks).values({
  config: JSON.stringify(versionedConfig),
});
```

## Schema Evolution

### Scenario: Adding a New Field

**Version 1:**
```typescript
const configV1 = z.object({
  url: z.string().url(),
  timeout: z.number().default(5000),
});
```

**Version 2:** Add `method` field
```typescript
const configV2 = z.object({
  url: z.string().url(),
  timeout: z.number().default(5000),
  method: z.enum(["GET", "POST", "HEAD"]).default("GET"),
});

type HttpCheckConfigV2 = z.infer<typeof configV2>;
```

### Create Migration

```typescript
const migrationV1toV2: ConfigMigration<HttpCheckConfigV1, HttpCheckConfigV2> = {
  fromVersion: 1,
  toVersion: 2,
  migrate: (data) => ({
    ...data,
    method: "GET", // Default for existing configs
  }),
};
```

### Register Migration

```typescript
export const httpHealthCheckStrategy: HealthCheckStrategy<HttpCheckConfigV2> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  configVersion: 2, // Updated version
  configSchema: configV2, // Updated schema
  migrations: [migrationV1toV2], // Migration chain
  
  async execute(config: HttpCheckConfigV2) {
    // Implementation uses new schema
  },
};
```

## Migration Chains

### Multiple Versions

When you have multiple schema versions, create a migration chain:

```typescript
// V1 -> V2: Add method
const migrationV1toV2: ConfigMigration<ConfigV1, ConfigV2> = {
  fromVersion: 1,
  toVersion: 2,
  migrate: (data) => ({
    ...data,
    method: "GET",
  }),
};

// V2 -> V3: Add headers
const migrationV2toV3: ConfigMigration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  migrate: (data) => ({
    ...data,
    headers: {},
  }),
};

// V3 -> V4: Rename timeout to timeoutMs
const migrationV3toV4: ConfigMigration<ConfigV3, ConfigV4> = {
  fromVersion: 3,
  toVersion: 4,
  migrate: (data) => ({
    url: data.url,
    method: data.method,
    headers: data.headers,
    timeoutMs: data.timeout, // Renamed field
  }),
};

// Register all migrations
export const httpHealthCheckStrategy: HealthCheckStrategy<ConfigV4> = {
  id: "http-check",
  configVersion: 4,
  configSchema: configV4,
  migrations: [
    migrationV1toV2,
    migrationV2toV3,
    migrationV3toV4,
  ],
  // ...
};
```

### Type-Safe Migration Builder

Use `MigrationChainBuilder` for better type inference:

```typescript
import { MigrationChainBuilder } from "@checkmate/backend-api";

const migrations = new MigrationChainBuilder<ConfigV1>()
  .addMigration<ConfigV2>({
    fromVersion: 1,
    toVersion: 2,
    migrate: (data) => ({ ...data, method: "GET" }),
  })
  .addMigration<ConfigV3>({
    fromVersion: 2,
    toVersion: 3,
    migrate: (data) => ({ ...data, headers: {} }),
  })
  .addMigration<ConfigV4>({
    fromVersion: 3,
    toVersion: 4,
    migrate: (data) => ({
      url: data.url,
      method: data.method,
      headers: data.headers,
      timeoutMs: data.timeout,
    }),
  })
  .build();
```

## Automatic Migration

The core automatically migrates configs when they're loaded:

```typescript
// User has a V1 config stored
const storedConfig: VersionedConfig<ConfigV1> = {
  version: 1,
  pluginId: "healthcheck-http-backend",
  data: {
    url: "https://example.com",
    timeout: 5000,
  },
};

// Core loads the config and applies migrations
const migratedConfig = await migrationRunner.migrate(
  storedConfig,
  httpHealthCheckStrategy.migrations,
  httpHealthCheckStrategy.configVersion
);

// Result: V4 config
{
  version: 4,
  pluginId: "healthcheck-http-backend",
  data: {
    url: "https://example.com",
    timeoutMs: 5000,
    method: "GET",
    headers: {},
  },
  migratedAt: new Date(),
  originalVersion: 1,
}
```

## Migration Best Practices

### 1. Never Skip Versions

Always increment version by 1:

```typescript
// ✅ Good
configVersion: 1 -> 2 -> 3 -> 4

// ❌ Bad
configVersion: 1 -> 3 -> 5
```

### 2. Provide Sensible Defaults

When adding required fields, provide defaults for existing configs:

```typescript
migrate: (data) => ({
  ...data,
  newRequiredField: "default-value",
})
```

### 3. Document Breaking Changes

If a migration changes behavior significantly, document it:

```typescript
// V2 -> V3: BREAKING: Changed timeout from seconds to milliseconds
const migrationV2toV3: ConfigMigration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  migrate: (data) => ({
    ...data,
    timeout: data.timeout * 1000, // Convert seconds to milliseconds
  }),
};
```

### 4. Test Migrations

Always test migrations with real data:

```typescript
import { describe, expect, test } from "bun:test";

describe("Config Migrations", () => {
  test("migrates V1 to V2", () => {
    const v1: ConfigV1 = {
      url: "https://example.com",
      timeout: 5000,
    };

    const v2 = migrationV1toV2.migrate(v1);

    expect(v2).toEqual({
      url: "https://example.com",
      timeout: 5000,
      method: "GET",
    });
  });

  test("migrates V1 to V4 through chain", async () => {
    const v1Config: VersionedConfig<ConfigV1> = {
      version: 1,
      pluginId: "test",
      data: {
        url: "https://example.com",
        timeout: 5000,
      },
    };

    const migrated = await migrationRunner.migrate(
      v1Config,
      migrations,
      4
    );

    expect(migrated.version).toBe(4);
    expect(migrated.data.timeoutMs).toBe(5000);
    expect(migrated.originalVersion).toBe(1);
  });
});
```

### 5. Keep Old Schemas

Don't delete old schema definitions—you need them for type safety:

```typescript
// Keep all versions for reference and type safety
export const configV1 = z.object({ /* ... */ });
export const configV2 = z.object({ /* ... */ });
export const configV3 = z.object({ /* ... */ });
export const configV4 = z.object({ /* ... */ }); // Current

export type ConfigV1 = z.infer<typeof configV1>;
export type ConfigV2 = z.infer<typeof configV2>;
export type ConfigV3 = z.infer<typeof configV3>;
export type ConfigV4 = z.infer<typeof configV4>;
```

## Advanced Patterns

### Async Migrations

Migrations can be async for complex transformations:

```typescript
const migrationV2toV3: ConfigMigration<ConfigV2, ConfigV3> = {
  fromVersion: 2,
  toVersion: 3,
  migrate: async (data) => {
    // Fetch additional data if needed
    const metadata = await fetchMetadata(data.url);
    
    return {
      ...data,
      metadata,
    };
  },
};
```

### Conditional Migrations

Apply different logic based on config data:

```typescript
migrate: (data) => {
  if (data.type === "http") {
    return {
      ...data,
      protocol: "https",
    };
  } else {
    return {
      ...data,
      protocol: "tcp",
    };
  }
}
```

### Data Validation During Migration

Validate data during migration to catch issues:

```typescript
migrate: (data) => {
  const migrated = {
    ...data,
    timeout: data.timeout * 1000,
  };
  
  // Validate the migrated data
  const result = configV3.safeParse(migrated);
  
  if (!result.success) {
    throw new Error(`Migration failed validation: ${result.error}`);
  }
  
  return result.data;
}
```

## Rollback Support

### Downgrade Migrations

You can optionally support downgrading:

```typescript
interface BiDirectionalMigration<TFrom, TTo> {
  fromVersion: number;
  toVersion: number;
  migrate: (data: TFrom) => TTo;
  rollback: (data: TTo) => TFrom; // Optional
}

const migrationV1toV2: BiDirectionalMigration<ConfigV1, ConfigV2> = {
  fromVersion: 1,
  toVersion: 2,
  migrate: (data) => ({ ...data, method: "GET" }),
  rollback: (data) => {
    const { method, ...rest } = data;
    return rest;
  },
};
```

## Real-World Example

### HTTP Health Check Evolution

```typescript
// Version 1: Basic HTTP check
const configV1 = z.object({
  url: z.string().url(),
  timeout: z.number(),
});

// Version 2: Add HTTP method
const configV2 = z.object({
  url: z.string().url(),
  timeout: z.number(),
  method: z.enum(["GET", "POST", "HEAD"]),
});

// Version 3: Add headers and body
const configV3 = z.object({
  url: z.string().url(),
  timeout: z.number(),
  method: z.enum(["GET", "POST", "HEAD", "PUT", "DELETE"]),
  headers: z.record(z.string()),
  body: z.string().optional(),
});

// Version 4: Add retry logic
const configV4 = z.object({
  url: z.string().url(),
  timeout: z.number(),
  method: z.enum(["GET", "POST", "HEAD", "PUT", "DELETE"]),
  headers: z.record(z.string()),
  body: z.string().optional(),
  retries: z.number().min(0).max(5),
  retryDelay: z.number().min(0),
});

// Migrations
const migrations = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (data: z.infer<typeof configV1>) => ({
      ...data,
      method: "GET" as const,
    }),
  },
  {
    fromVersion: 2,
    toVersion: 3,
    migrate: (data: z.infer<typeof configV2>) => ({
      ...data,
      headers: {},
      body: undefined,
    }),
  },
  {
    fromVersion: 3,
    toVersion: 4,
    migrate: (data: z.infer<typeof configV3>) => ({
      ...data,
      retries: 3,
      retryDelay: 1000,
    }),
  },
];

// Strategy uses latest version
export const httpHealthCheckStrategy: HealthCheckStrategy<z.infer<typeof configV4>> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  configVersion: 4,
  configSchema: configV4,
  migrations,
  
  async execute(config) {
    // Implementation uses V4 schema
  },
};
```

## Troubleshooting

### Migration Not Running

Check that:
1. Migration `fromVersion` and `toVersion` are correct
2. Migrations are registered in the strategy
3. `configVersion` matches the latest version

### Type Errors

Ensure:
1. Migration input/output types match schema versions
2. All schema versions are exported
3. Migration chain types are correct

### Data Loss

Always:
1. Test migrations with production data
2. Keep backups before upgrading
3. Validate migrated data

## Next Steps

- [Backend Plugin Development](./backend-plugins.md)
- [Extension Points](./extension-points.md)
- [Contributing Guide](./contributing.md)
