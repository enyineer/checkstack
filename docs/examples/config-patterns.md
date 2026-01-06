---
---
# Configuration Patterns

Common patterns for managing plugin configuration. See [Versioned Configs](../backend/versioned-configs.md) and [Config Service](../backend/config-service.md).

## Basic Config Schema

```typescript
import { z } from "zod";
import { secret } from "@checkmate-monitor/backend-api";

const configSchema = z.object({
  // Simple fields
  enabled: z.boolean().default(true).describe("Enable this feature"),
  maxItems: z.number().min(1).max(1000).default(100).describe("Maximum items"),
  
  // Secret field (encrypted at rest)
  apiKey: secret().describe("API key for external service"),
  
  // Optional with default
  retryAttempts: z.number().default(3).describe("Number of retries"),
});

type MyConfig = z.infer<typeof configSchema>;
```

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
  concurrency: z.number().default(10),
  // Testing-only option
  delayMultiplier: z.number().min(0).max(1).default(1)
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
