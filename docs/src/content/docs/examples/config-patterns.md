---
title: "Config Patterns"
---
## Config Versioning

```typescript
export class MyPlugin implements QueuePlugin<MyConfig> {
  configVersion = 2; // Increment when schema changes
  configSchema = configSchema;
  
  migrations = [
    {
      fromVersion: 1,
      toVersion: 2,
      migrate: (old: any) => ({
        ...old,
        // Add new field with default
        newField: old.newField ?? "default-value",
        // Rename field
        renamedField: old.oldFieldName,
      }),
    },
  ];
}
```

---

## Accessing Config in Handlers

```typescript
// Get redacted config (safe for frontend)
getConfiguration: os.handler(async ({ context }) => {
  const config = await context.configService.getRedacted(
    pluginId,
    plugin.configSchema,
    plugin.configVersion
  );
  return { pluginId, config };
}),

// Get full config (backend only)
const fullConfig = await context.configService.get(
  pluginId,
  plugin.configSchema,
  plugin.configVersion
);
```

---

## Saving Config

```typescript
updateConfiguration: os.handler(async ({ input, context }) => {
  await context.configService.set(
    input.pluginId,
    input.config,
    plugin.configSchema,
    plugin.configVersion
  );
  return { success: true };
}),
```

---

## Testing Configuration (delayMultiplier)

For queue plugins or time-sensitive tests:

```typescript
const configSchema = z.object({
  concurrency: configNumber({}).default(10),
  // Testing-only option
  delayMultiplier: configNumber({}).min(0).max(1).default(1)
    .describe("Delay multiplier (default: 1). Only change for testing purposes."),
});

// In tests
const queue = new InMemoryQueue("test", {
  concurrency: 10,
  delayMultiplier: 0.01, // 100x faster
});
```

---

## See Also

- [Versioned Configs](../backend/versioned-configs.md)
- [Config Service](../backend/config-service.md)
- [Secrets Encryption](../security/secrets.md)
