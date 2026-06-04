---
title: "Versioned Data System"
description: "Backward-compatible schema evolution for plugin configurations using version-stamped migrations."
---

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
import { Versioned, z } from "@checkstack/backend-api";

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
import { Versioned } from "@checkstack/backend-api";

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
import { MigrationBuilder } from "@checkstack/backend-api";

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

### Assume-v1-on-read (unversioned blobs)

Some configs are stored UNVERSIONED - the raw payload is nested inside a
larger JSON document with no `version` discriminator. Automation action /
trigger configs live this way inside the `automations.definition` blob, and
health-check **strategy** + **collector** configs live this way in
`healthCheckConfigurations.config` and `.collectors[].config`. For those,
wrap the raw value as `{ version: 1, data }`, run the migration chain, then
validate. Two helpers do exactly that:

```typescript
// Runtime / read path: migrate, then validate LENIENTLY (unknown keys are
// stripped). A stored config that picked up a now-removed key survives.
const config = await versioned.parseAssumingV1(rawData);

// Editor / validation path: migrate, then validate STRICTLY (unknown keys
// on a plain-object schema are REJECTED). Removed/renamed fields are
// migrated away first, so they don't error - but a genuine typo the
// migration does not account for still surfaces to the operator.
const config = await versioned.parseStrictAssumingV1(rawData);
```

For a `version: 1` config with no migrations both are just a validate; for
a `version > 1` config they run the full chain first. This is how a removed
field is retired without a data migration: bump the config to the next
version and add a migration that drops the key. The script plugin's
`run_script` / `run_shell` actions did exactly this to retire their old
per-action `sandbox` key (which now lives globally) - see
[Extending automations](/checkstack/developer-guide/backend/automations/extending/).

Health-check strategy and collector configs use the same approach. Each
config declares its full v1 -> current migration chain, and both the
execution path (the queue executor: strategy config once before the
per-environment render loop, then each collector config before
render+execute) and the read path (`getConfiguration`) call
`parseAssumingV1` so a stored, genuinely-v1 blob is migrated, then
validated, before it is rendered or returned. Because the same config blob
is read on every tick, each reshaper migration is written to be
**IDEMPOTENT**: it guards on a legacy discriminator (a field the current
shape no longer has, e.g. `url`/`method` for HTTP or `command` for the
script execute collector) and passes already-current data through
untouched. Without that guard, re-running the chain on an already-migrated
blob could fabricate junk (e.g. shell-quoting a missing `command` into
`script: "undefined"`).

> [!IMPORTANT]
> A `version > 1` config that ships without a complete migration chain back
> to v1 makes `parseAssumingV1` fail at runtime. Two layers guard against
> this:
>
> 1. **Construction-time guard (fail-fast at boot).** Every `Versioned`
>    validates its own v1 -> `version` chain in its constructor. A
>    `version: 1` config with no migrations passes trivially; any
>    `version > 1` whose chain is incomplete or broken (a gap, or a step
>    that does not increment by exactly 1) **throws at construction**, which
>    runs at module import / plugin registration - so the platform fails
>    fast at boot instead of failing lazily on the first stale read. This
>    single guard covers every `Versioned` instance repo-wide, including
>    future plugin types.
> 2. **Contract tests (CI).** The structural check
>    `versioned.validateMigrationChainFromV1()` returns the first gap (or
>    `undefined` when the chain is complete); registry-driven contract tests
>    enumerate every registered automation config, every health-check
>    strategy + collector `config` / `result` / `aggregatedResult`, every
>    integration provider `connectionSchema`, and the anomaly + notification
>    configs, failing CI if a chain is missing - zero per-config upkeep.

> [!NOTE]
> **Auth strategies reuse the same boot guard.** Authentication strategies
> do not wrap their config in `Versioned`; they expose a bespoke shape
> `{ configVersion, configSchema, migrations }` and read config through the
> `ConfigService` chokepoint (`configService.get(id, schema, configVersion,
> migrations)`), which migrates-then-validates. To get the same fail-fast
> behaviour, the auth-backend's `betterAuthExtensionPoint.addStrategy`
> registration chokepoint calls the standalone, exported pure helper
> `assertMigrationChainFromV1({ version, migrations })` (the single shared
> implementation behind the `Versioned` constructor guard and
> `validateMigrationChainFromV1`). A strategy declaring `configVersion > 1`
> with an incomplete or broken chain therefore **throws at registration**
> (boot) with a message naming the strategy id, rather than failing lazily
> on the first stale read. A registry-driven contract test
> (`core/auth-backend/src/migration-chain-contract.test.ts`) pins the guard's
> contract: it accepts a complete chain and bites on a deliberately-broken
> one.

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

## Validate fresh input vs parse stored data

Always go through a `Versioned` method - never reach for the raw zod schema.
The method you pick encodes whether the data is FRESH (already current
version) or STORED (possibly an older shape that must be migrated first):

- **FRESH current-version input** (e.g. an RPC payload from a connection /
  config form the user just submitted): use `validate()` /
  `safeValidate()`. The data is already shaped for the current version, so
  there is nothing to migrate - just validate.
- **STORED data** (a blob loaded from the database / authored gitops YAML
  that may predate a `version` bump): use `parse()` / `parseRecord()` for a
  versioned envelope, or `parseAssumingV1()` / `parseStrictAssumingV1()` for
  an unversioned blob. These run the migration chain first, then validate,
  so an old-shape blob still applies.

```typescript
// FRESH: connection form input, already current version.
const result = provider.connectionSchema.safeValidate(input);
if (!result.success) throw new ORPCError("BAD_REQUEST", { ... });

// STORED: authored gitops YAML that may use an OLD config shape.
// Migrate-then-validate-strict so old-shape YAML still applies while a
// genuine typo (unknown key no migration accounts for) is still rejected.
const config = await strategy.config.parseStrictAssumingV1(authoredConfig);
```

> [!CAUTION]
> Calling a parse method directly on a `Versioned`'s `.schema` member -
> `versioned.schema.parse(...)` / `.safeParse(...)` / `.parseAsync(...)` /
> `.strict()...` - **bypasses the migration chain** (for stored data) or the
> intention-revealing fresh-input path. An ESLint `no-restricted-syntax`
> rule bans this pattern repo-wide and points you at the right method:
> `.parse()` / `.parseAssumingV1()` / `.parseStrictAssumingV1()` for STORED
> data, `.validate()` / `.safeValidate()` for FRESH current-version input.
> Only the `Versioned` implementation itself (`config-versioning.ts`) is
> exempt - it is the one place that legitimately calls `this.schema.parse`.
> Passing a `.schema` to a transport helper that needs the raw zod schema
> (e.g. `resolveSecretsBySchema({ schema })` for x-secret field discovery)
> is fine: the ban only triggers on a parse/validate CALL made on `.schema`.

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

- [Backend Plugin Development](/checkstack/developer-guide/backend/plugins/)
- [Health Check System](/checkstack/developer-guide/backend/healthchecks/data-management/)
- [Contributing Guide](/checkstack/developer-guide/getting-started/contributing/)
