---
"@checkmate/backend-api": major
"@checkmate/backend": patch
"@checkmate/queue-api": patch
"@checkmate/healthcheck-backend": patch
"@checkmate/healthcheck-http-backend": patch
---

## Breaking: Unified Versioned<T> Architecture

Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

### Breaking Changes

- **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
- **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
- **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
- **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
- **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
- **`migrateVersionedData()`** is removed (use `versioned.parse()`)
- **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

### Migration Guide

Before:
```typescript
const strategy: HealthCheckStrategy = {
  config: {
    version: 1,
    schema: mySchema,
    migrations: [],
  },
};
const data = await migrateVersionedData(stored, 1, migrations);
```

After:
```typescript
const strategy: HealthCheckStrategy = {
  config: new Versioned({
    version: 1,
    schema: mySchema,
    migrations: [],
  }),
};
const data = await strategy.config.parse(stored);
```
