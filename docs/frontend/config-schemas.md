---
---
# Sending Configuration Schemas to Frontend

This guide documents the required pattern for exposing plugin configuration schemas to the frontend to enable dynamic form rendering with proper secret field handling.

## Overview

When building admin UIs for plugins, configuration schemas must be converted to JSON Schema format and sent to the frontend. The **critical requirement** is to use the custom `toJsonSchema()` utility from `@checkmate/backend-api` instead of Zod's native `toJSONSchema()` method.

## The Problem

The `DynamicForm` component in `@checkmate/ui` automatically renders password input fields (with show/hide toggles) for fields marked as secrets. However, it relies on the `x-secret` metadata in the JSON Schema to identify these fields.

**Zod's native method does NOT add this metadata:**
```typescript
// ❌ WRONG: Missing x-secret metadata
import { z } from "zod";
const jsonSchema = mySchema.toJSONSchema();
// Result: Secret fields render as regular text inputs
```

## The Solution

Use the custom `toJsonSchema()` function from `@checkmate/backend-api`:

```typescript
// ✅ CORRECT: Adds x-secret metadata
import { toJsonSchema } from "@checkmate/backend-api";
const jsonSchema = toJsonSchema(mySchema);
// Result: Secret fields render as password inputs with show/hide toggle
```

## Complete Implementation Pattern

### 1. Backend Router

When exposing plugin/strategy metadata to the frontend:

```typescript
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext, toJsonSchema } from "@checkmate/backend-api";
import { myPluginContract } from "@checkmate/myplugin-common";

// Contract-based implementation with auto auth enforcement
const os = implement(myPluginContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createMyPluginRouter = () => {
  return os.router({
    // Auth and permissions auto-enforced from contract meta
    getPlugins: os.getPlugins.handler(async ({ context }) => {
      const plugins = context.myPluginRegistry.getPlugins().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        configVersion: p.configVersion,
        configSchema: toJsonSchema(p.configSchema),  // ✅ Use custom function
      }));
      return plugins;
    }),
  });
};
```

### 2. Plugin/Strategy Schema Definition

Use the `secret()` helper for sensitive fields:

```typescript
import { secret } from "@checkmate/backend-api";
import { z } from "zod";

const configSchema = z.object({
  host: z.string().default("localhost").describe("API host"),
  port: z.number().default(443).describe("API port"),
  apiKey: secret().describe("API authentication key"),  // ✅ Marked as secret
  username: z.string().optional().describe("Username"),
  password: secret().optional().describe("Password"),   // ✅ Marked as secret
});
```

### 3. Frontend Consumption

The frontend automatically handles the password fields:

```typescript
import { PluginConfigForm } from "@checkmate/ui";

// The configSchema from the backend already has x-secret metadata
<PluginConfigForm
  plugins={plugins}  // Contains schemas with x-secret metadata
  selectedPluginId={selectedPluginId}
  config={config}
  onConfigChange={setConfig}
/>
```

## How It Works

### Backend: Schema Conversion Process

The `toJsonSchema()` function in [`schema-utils.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/backend-api/src/schema-utils.ts):

1. Calls Zod's native `toJSONSchema()` to get the base JSON Schema
2. Traverses the Zod schema to identify fields created with `secret()`
3. Adds `x-secret: true` metadata to those fields in the JSON Schema
4. Returns the enhanced JSON Schema

```typescript
// Simplified implementation
function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodSchema.toJSONSchema();
  addSecretMetadata(zodSchema, jsonSchema);  // Adds x-secret: true
  return jsonSchema;
}
```

### Frontend: Password Field Rendering

The `DynamicForm` component in [`DynamicForm.tsx`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/ui/src/components/DynamicForm.tsx) detects secret fields:

```typescript
// Detect secret fields from x-secret metadata
const isSecret = propSchema["x-secret"];

if (isSecret) {
  // Render password input with show/hide toggle
  return <Input type={showPassword ? "text" : "password"} ... />;
}
```

## Secret Handling Best Practices

### 1. Marking Fields as Secrets

Use the `secret()` helper for any sensitive data:
- Passwords
- API keys
- Authentication tokens
- Private keys
- Database connection strings with credentials

```typescript
import { secret } from "@checkmate/backend-api";

const schema = z.object({
  // Regular field
  timeout: z.number().default(5000),
  
  // Secret field
  accessToken: secret().describe("OAuth access token"),
});
```

### 2. Optional vs Required Secrets

Secrets can be optional or required (via defaults):

```typescript
const schema = z.object({
  // Optional secret (can be empty)
  password: secret().optional().describe("Password (optional)"),
  
  // Required secret (has default, but user should change it)
  apiKey: secret().default("").describe("API Key"),
});
```

### 3. Configuration Retrieval Security

When returning current configuration to the frontend for editing:

```typescript
// ✅ CORRECT: Use getRedacted() to remove secrets
getConfiguration: os.getConfiguration.handler(async ({ context }) => {
  const config = await context.configService.getRedacted(
    pluginId,
    plugin.configSchema,
    plugin.configVersion
  );
  
  return { pluginId, config };  // Secrets are empty/undefined
}),

// ❌ WRONG: Exposes unredacted secrets to frontend
getConfiguration: os.getConfiguration.handler(async ({ context }) => {
  const config = await context.configService.get(...);
  return { pluginId, config };  // Security vulnerability!
}),
```

## Testing

Verify schema conversion includes secret metadata:

```typescript
import { describe, test, expect } from "bun:test";
import { toJsonSchema } from "@checkmate/backend-api";
import { myPluginConfigSchema } from "./schema";

describe("Plugin Config Schema", () => {
  test("should mark password field as secret", () => {
    const jsonSchema = toJsonSchema(myPluginConfigSchema);
    
    expect(jsonSchema.properties.password["x-secret"]).toBe(true);
  });
});
```

## Common Mistakes

### ❌ Using Native Zod Method
```typescript
// WRONG: No x-secret metadata
configSchema: zod.toJSONSchema(p.configSchema)
```

### ❌ Forgetting to Import
```typescript
// WRONG: Using wrong function
import { zod } from "@checkmate/backend-api";
configSchema: zod.toJSONSchema(p.configSchema)
```

### ❌ Not Using secret() Helper
```typescript
// WRONG: Regular string field for sensitive data
password: z.string().describe("Password")
```

### ✅ Correct Pattern
```typescript
import { toJsonSchema, secret } from "@checkmate/backend-api";

// In schema
password: secret().describe("Password")

// In router
configSchema: toJsonSchema(p.configSchema)
```

## Reference Implementations

**Good examples to follow:**
- [`auth-backend/router.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/plugins/auth-backend/src/router.ts#L273-281) - Uses `toJsonSchema` and `getRedacted`
- [`queue-backend/router.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/plugins/queue-backend/src/router.ts#L24) - Uses `toJsonSchema`
- [`auth-ldap-backend/strategy.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/plugins/auth-ldap-backend/src/strategy.ts) - Uses `secret()` helper

## Summary

**Always follow these rules when exposing config schemas to the frontend:**

1. ✅ Use `toJsonSchema()` from `@checkmate/backend-api`, not Zod's native method
2. ✅ Mark sensitive fields with `secret()` in your schemas  
3. ✅ Use `ConfigService.getRedacted()` when returning current config to frontend
4. ✅ Test that secret fields have `x-secret: true` metadata

This ensures:
- Password fields render correctly with show/hide toggles
- Secrets never leak to the frontend
- Consistent security behavior across all plugins
