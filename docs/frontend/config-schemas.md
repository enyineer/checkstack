---
---
# Sending Configuration Schemas to Frontend

This guide documents the required pattern for exposing plugin configuration schemas to the frontend to enable dynamic form rendering with proper secret field handling.

## Overview

When building admin UIs for plugins, configuration schemas must be converted to JSON Schema format and sent to the frontend. The **critical requirement** is to use the custom `toJsonSchema()` utility from `@checkstack/backend-api` instead of Zod's native `toJSONSchema()` method.

## The Problem

The `DynamicForm` component in `@checkstack/ui` automatically renders password input fields (with show/hide toggles) for fields marked as secrets. However, it relies on the `x-secret` metadata in the JSON Schema to identify these fields.

**Zod's native method does NOT add this metadata:**
```typescript
// ❌ WRONG: Missing x-secret metadata
import { z } from "zod";
const jsonSchema = mySchema.toJSONSchema();
// Result: Secret fields render as regular text inputs
```

## The Solution

Use the custom `toJsonSchema()` function from `@checkstack/backend-api`:

```typescript
// ✅ CORRECT: Adds x-secret metadata
import { toJsonSchema } from "@checkstack/backend-api";
const jsonSchema = toJsonSchema(mySchema);
// Result: Secret fields render as password inputs with show/hide toggle
```

## Complete Implementation Pattern

### 1. Backend Router

When exposing plugin/strategy metadata to the frontend:

```typescript
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext, toJsonSchema } from "@checkstack/backend-api";
import { myPluginContract } from "@checkstack/myplugin-common";

// Contract-based implementation with auto auth enforcement
const os = implement(myPluginContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createMyPluginRouter = () => {
  return os.router({
    // Auth and access rules auto-enforced from contract meta
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

Use factory functions for fields that need specialized handling:

```typescript
import { configString, configNumber, configBoolean } from "@checkstack/backend-api";
import { z } from "zod";

const configSchema = z.object({
  host: configString({}).default("localhost").describe("API host"),
  port: configNumber({}).default(443).describe("API port"),
  apiKey: configString({ "x-secret": true }).describe("API authentication key"),  // Marked as secret
  username: configString({}).optional().describe("Username"),
  password: configString({ "x-secret": true }).optional().describe("Password"),   // Marked as secret
});
```

### 3. Frontend Consumption

The frontend automatically handles the password fields:

```typescript
import { PluginConfigForm } from "@checkstack/ui";

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

The `toJsonSchema()` function in [`schema-utils.ts`](/core/backend-api/src/schema-utils.ts):

1. Calls Zod's native `toJSONSchema()` to get the base JSON Schema
2. Traverses the Zod schema to identify fields created with branded types (`secret()`, `color()`)
3. Adds `x-secret: true` or `x-color: true` metadata to those fields
4. Returns the enhanced JSON Schema

```typescript
// Simplified implementation
function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodSchema.toJSONSchema();
  addSchemaMetadata(zodSchema, jsonSchema);  // Adds x-secret, x-color
  return jsonSchema;
}
```

### Frontend: Specialized Field Rendering

The `DynamicForm` component in [`DynamicForm.tsx`](/core/ui/src/components/DynamicForm.tsx) detects branded fields:

```typescript
// Detect secret fields from x-secret metadata
const isSecret = propSchema["x-secret"];
if (isSecret) {
  // Render password input with show/hide toggle
  return <Input type={showPassword ? "text" : "password"} ... />;
}

// Detect color fields from x-color metadata
const isColor = propSchema["x-color"];
if (isColor) {
  // Render color picker with swatch and text input
  return <ColorPicker value={value} onChange={onChange} />;
}
```

## Factory Functions Reference

The platform provides factory functions for creating Zod schemas with specialized metadata:

### `configString({ "x-secret": true })` - Sensitive Data

Use for passwords, API keys, tokens, and other sensitive data:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  apiKey: configString({ "x-secret": true }).describe("API authentication key"),
  password: configString({ "x-secret": true }).optional().describe("Optional password"),
});
```

**Features:**
- Renders as password input with show/hide toggle
- Values are encrypted at rest via `ConfigService`
- Redacted when returning config to frontend

### `configString({ "x-color": true })` - Hex Colors

Use for hex color values (e.g., brand colors, theme colors):

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // With default value
  primaryColor: configString({ "x-color": true }).default("#3b82f6").describe("Primary brand color"),
  // Optional without default
  accentColor: configString({ "x-color": true }).optional().describe("Accent color"),
});
```

**Features:**
- Renders as color picker with swatch + text input
- Validates hex format (`#RGB` or `#RRGGBB`)
- Supports optional default values

### `configString({ "x-options-resolver": ... })` - Dynamic Dropdowns

Use for fields that need to fetch options dynamically from the backend:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // Basic options resolver
  projectKey: configString({
    "x-options-resolver": "projectOptions",
  }).describe("Jira project"),
  
  // With dependencies (refetches when dependent fields change)
  issueTypeId: configString({
    "x-options-resolver": "issueTypeOptions",
    "x-depends-on": ["projectKey"],
  }).describe("Issue type"),
  
  // With searchable dropdown for many options
  fieldKey: configString({
    "x-options-resolver": "fieldOptions",
    "x-depends-on": ["projectKey", "issueTypeId"],
    "x-searchable": true,
  }).describe("Jira field"),
});
```

**Features:**
- Renders as a dropdown that fetches options from backend
- `x-options-resolver`: Name of the resolver function to call
- `x-depends-on`: Array of field names that trigger refetch when changed
- `x-searchable`: When true, renders a searchable dropdown with filter input inside

**Implementation requirements:**
The provider must implement `getConnectionOptions()` to handle resolver calls. See [Integration Providers](../backend/integration-providers.md#connection-based-providers-with-dynamic-options) for details.

### `configString({ "x-hidden": true })` - Auto-populated Fields

Use for fields that are auto-populated and should not be shown in the form:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // Hidden field (auto-populated)
  connectionId: configString({ "x-hidden": true }).describe("Connection ID (auto-populated)"),
  
  // Normal visible fields
  name: configString({}).describe("Subscription name"),
});
```

**Features:**
- Field is hidden from the form UI
- Value is typically set programmatically
- Useful for connection IDs or other auto-populated values


## Secret Handling Best Practices

### 1. Marking Fields as Secrets

Use `configString({ "x-secret": true })` for any sensitive data:
- Passwords
- API keys
- Authentication tokens
- Private keys
- Database connection strings with credentials

```typescript
import { configString, configNumber } from "@checkstack/backend-api";

const schema = z.object({
  // Regular field
  timeout: configNumber({}).default(5000),
  
  // Secret field
  accessToken: configString({ "x-secret": true }).describe("OAuth access token"),
});
```

### 2. Optional vs Required Secrets

Secrets can be optional or required (via defaults):

```typescript
const schema = z.object({
  // Optional secret (can be empty)
  password: configString({ "x-secret": true }).optional().describe("Password (optional)"),
  
  // Required secret (has default, but user should change it)
  apiKey: configString({ "x-secret": true }).default("").describe("API Key"),
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
import { toJsonSchema } from "@checkstack/backend-api";
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
import { zod } from "@checkstack/backend-api";
configSchema: zod.toJSONSchema(p.configSchema)
```

### ❌ Not Using secret() Helper
```typescript
// WRONG: Regular string field for sensitive data
password: z.string().describe("Password")
```

### ✅ Correct Pattern
```typescript
import { toJsonSchema, configString } from "@checkstack/backend-api";

// In schema
password: configString({ "x-secret": true }).describe("Password")

// In router
configSchema: toJsonSchema(p.configSchema)
```

## Reference Implementations

**Good examples to follow:**
- [`auth-backend/router.ts`](/plugins/auth-backend/src/router.ts) - Uses `toJsonSchema` and `getRedacted`
- [`queue-backend/router.ts`](/plugins/queue-backend/src/router.ts) - Uses `toJsonSchema`
- [`auth-ldap-backend/strategy.ts`](/plugins/auth-ldap-backend/src/strategy.ts) - Uses `secret()` helper

## Summary

**Always follow these rules when exposing config schemas to the frontend:**

1. ✅ Use `toJsonSchema()` from `@checkstack/backend-api`, not Zod's native method
2. ✅ Mark sensitive fields with `configString({ "x-secret": true })` in your schemas  
3. ✅ Use `ConfigService.getRedacted()` when returning current config to frontend
4. ✅ Test that secret fields have `x-secret: true` metadata

This ensures:
- Password fields render correctly with show/hide toggles
- Secrets never leak to the frontend
- Consistent security behavior across all plugins
