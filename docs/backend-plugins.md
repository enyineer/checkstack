# Backend Plugin Development Guide

## Overview

Backend plugins provide REST APIs, business logic, database schemas, and integration with external services. They are built using **Hono** for routing, **Drizzle** for database access, and **Zod** for validation.

## Quick Start

### 1. Create Plugin Structure

```bash
mkdir -p plugins/myplugin-backend/src
cd plugins/myplugin-backend
```

### 2. Initialize package.json

```json
{
  "name": "@checkmate/myplugin-backend",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts"
    }
  },
  "dependencies": {
    "@checkmate/backend-api": "workspace:*",
    "@checkmate/common": "workspace:*",
    "@checkmate/myplugin-common": "workspace:*",
    "drizzle-orm": "^0.38.3",
    "hono": "^4.6.14",
    "zod": "^4.2.1"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "^0.30.0",
    "typescript": "^5.7.2"
  }
}
```
```bash
bun run sync
```

See [Monorepo Tooling](./monorepo-tooling.md) for details on shared configurations.

### 3. Create Plugin Entry Point

**src/index.ts:**

```typescript
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissionList, permissions } from "@checkmate/myplugin-common";
import * as schema from "./schema";

export default createBackendPlugin({
  pluginId: "myplugin-backend",
  register(env) {
    // Register permissions
    env.registerPermissions(permissionList);

    // Register initialization
    env.registerInit({
      schema,
      deps: {
        router: coreServices.httpRouter,
        logger: coreServices.logger,
        check: coreServices.permissionCheck,
        validate: coreServices.validation,
      },
      init: async ({ database, router, logger, check, validate }) => {
        logger.info("Initializing MyPlugin Backend...");

        // Define routes
        router.get("/items", check(permissions.itemRead.id), async (c) => {
          const items = await database.select().from(schema.items);
          return c.json(items);
        });

        router.post(
          "/items",
          check(permissions.itemCreate.id),
          validate(itemSchema),
          async (c) => {
            const body = await c.req.json();
            const [item] = await database
              .insert(schema.items)
              .values(body)
              .returning();
            return c.json(item);
          }
        );

        logger.info("✅ MyPlugin Backend initialized.");
      },
    });
  },
});
```

## Plugin Registration API

### `createBackendPlugin(config)`

Creates a backend plugin with the specified configuration.

**Parameters:**
- `pluginId` (string): Unique identifier for the plugin
- `register` (function): Registration function called by the core

### Registration Environment (`env`)

The `register` function receives an environment object with these methods:

#### `env.registerPermissions(permissions: Permission[])`

Register permissions that this plugin provides.

```typescript
env.registerPermissions([
  { id: "item.read", description: "Read items" },
  { id: "item.create", description: "Create items" },
]);
```

> **Note**: The core automatically prefixes permission IDs with the plugin ID.
> `item.read` becomes `myplugin-backend.item.read`

#### `env.registerInit(config)`

Register the plugin's initialization function.

**Config:**
- `schema`: Drizzle schema object (optional)
- `deps`: Dependencies to inject
- `init`: Async initialization function

```typescript
env.registerInit({
  schema: mySchema,
  deps: {
    router: coreServices.httpRouter,
    logger: coreServices.logger,
  },
  init: async ({ database, router, logger }) => {
    // Plugin initialization logic
  },
});
```

#### `env.registerService<S>(ref: ServiceRef<S>, impl: S)`

Register a service that other plugins can use.

```typescript
const myServiceRef = createServiceRef<MyService>("my-service");

env.registerService(myServiceRef, {
  doSomething: async () => {
    // Implementation
  },
});
```

#### `env.registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T)`

Register an implementation for an extension point.

```typescript
import { healthCheckExtensionPoint } from "@checkmate/backend-api";

env.registerExtensionPoint(healthCheckExtensionPoint, {
  id: "http-check",
  displayName: "HTTP Health Check",
  execute: async (config) => {
    // Implementation
  },
});
```

## Core Services

The core provides these services via `coreServices`:

### `coreServices.httpRouter`

A Hono router instance scoped to your plugin.

**Routes are automatically mounted at:** `/api/<pluginId>/`

```typescript
router.get("/items", async (c) => {
  // Accessible at: /api/myplugin-backend/items
  return c.json({ items: [] });
});
```

### `coreServices.logger`

Structured logging service.

```typescript
logger.info("Informational message");
logger.warn("Warning message");
logger.error("Error message");
logger.debug("Debug message");
```

### `coreServices.permissionCheck`

Middleware factory for permission checks.

```typescript
router.get("/items", check("item.read"), async (c) => {
  // Only accessible if user has permission
});
```

Returns **401 Unauthorized** if the user lacks the permission.

### `coreServices.validation`

Middleware factory for request validation using Zod schemas.

```typescript
const itemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

router.post("/items", validate(itemSchema), async (c) => {
  const body = await c.req.json();
  // body is typed and validated
});
```

Returns **400 Bad Request** with validation errors if the request is invalid.

## Database Schema

### Define Schema

**src/schema.ts:**

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### TypeScript Configuration

Backend plugins should extend the shared backend configuration.

**tsconfig.json:**

```json
{
  "extends": "@checkmate/tsconfig/backend.json",
  "include": ["src"]
}
```

See [Monorepo Tooling](./monorepo-tooling.md) for more information.

### Configure Drizzle

**drizzle.config.ts:**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  out: "./drizzle",
});
```

### Generate Migrations

```bash
bun run drizzle-kit generate
```

This creates migration files in `./drizzle/`.

### Automatic Migration

The core **automatically runs migrations** when the plugin loads. No manual migration step needed!

See [drizzle-schema-isolation.md](./drizzle-schema-isolation.md) for details.

## Dependency Injection

### Declaring Dependencies

```typescript
env.registerInit({
  deps: {
    router: coreServices.httpRouter,
    logger: coreServices.logger,
    myService: myServiceRef,
  },
  init: async ({ router, logger, myService }) => {
    // All dependencies are resolved and typed
  },
});
```

### Type Safety

Dependencies are fully typed. TypeScript will error if:
- You declare a dependency that doesn't exist
- You use a dependency with the wrong type
- You forget to declare a dependency you use

## Permission Patterns

### Define in Common Package

**plugins/myplugin-common/src/permissions.ts:**

```typescript
import type { Permission } from "@checkmate/common";

export const permissions = {
  itemRead: {
    id: "item.read",
    description: "Read items",
  },
  itemCreate: {
    id: "item.create",
    description: "Create items",
  },
  itemUpdate: {
    id: "item.update",
    description: "Update items",
  },
  itemDelete: {
    id: "item.delete",
    description: "Delete items",
  },
} satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
```

### Use in Backend

```typescript
import { permissionList, permissions } from "@checkmate/myplugin-common";

env.registerPermissions(permissionList);

router.get("/items", check(permissions.itemRead.id), async (c) => {
  // Protected route
});
```

## Validation Patterns

### Define Schemas

**src/schemas.ts:**

```typescript
import { z } from "zod";

export const createItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export const updateItemSchema = createItemSchema.partial();
```

### Use in Routes

```typescript
router.post(
  "/items",
  check(permissions.itemCreate.id),
  validate(createItemSchema),
  async (c) => {
    const body = await c.req.json();
    // body is validated and typed
  }
);
```

## Testing

### Unit Tests

**src/services/item-service.test.ts:**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../schema";
import { ItemService } from "./item-service";

describe("ItemService", () => {
  let db: ReturnType<typeof drizzle>;
  let service: ItemService;

  beforeEach(async () => {
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    db = drizzle(pool, { schema });
    service = new ItemService(db);

    // Clean up
    await db.delete(schema.items);
  });

  test("creates item", async () => {
    const item = await service.createItem({
      name: "Test Item",
      description: "Test Description",
    });

    expect(item.name).toBe("Test Item");
    expect(item.id).toBeDefined();
  });
});
```

### Integration Tests

Test plugin registration and initialization:

```typescript
import { describe, expect, test } from "bun:test";
import plugin from "./index";

describe("MyPlugin Backend", () => {
  test("exports plugin", () => {
    expect(plugin.pluginId).toBe("myplugin-backend");
    expect(plugin.register).toBeFunction();
  });
});
```

## Extension Points

### Implementing an Extension Point

```typescript
import { createExtensionPoint } from "@checkmate/backend-api";

// Define the extension point interface
export interface MyExtension {
  id: string;
  execute: (input: string) => Promise<string>;
}

// Create the extension point reference
export const myExtensionPoint = createExtensionPoint<MyExtension[]>(
  "my-extension"
);

// Register an implementation
env.registerExtensionPoint(myExtensionPoint, [
  {
    id: "impl-1",
    execute: async (input) => {
      return `Processed: ${input}`;
    },
  },
]);
```

### Using an Extension Point

```typescript
const implementations = env.getExtensionPoint(myExtensionPoint);

for (const impl of implementations) {
  const result = await impl.execute("test");
  logger.info(`Result from ${impl.id}: ${result}`);
}
```

## Best Practices

### 1. Use Services for Business Logic

Don't put business logic directly in route handlers:

```typescript
// ❌ Bad
router.post("/items", async (c) => {
  const body = await c.req.json();
  const [item] = await database.insert(schema.items).values(body).returning();
  return c.json(item);
});

// ✅ Good
router.post("/items", async (c) => {
  const body = await c.req.json();
  const item = await itemService.createItem(body);
  return c.json(item);
});
```

### 2. Always Validate Input

Use Zod schemas for all user input:

```typescript
router.post("/items", validate(createItemSchema), async (c) => {
  // Input is validated
});
```

### 3. Use Typed Errors

```typescript
class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item ${id} not found`);
    this.name = "ItemNotFoundError";
  }
}
```

### 4. Log Important Events

```typescript
logger.info("Item created", { itemId: item.id });
logger.warn("Item not found", { itemId: id });
logger.error("Failed to create item", { error: err.message });
```

### 5. Write Tests

Test all services and critical paths:

```bash
bun test
```

## Common Patterns

### CRUD Operations

```typescript
// List
router.get("/items", check(permissions.itemRead.id), async (c) => {
  const items = await itemService.getItems();
  return c.json(items);
});

// Get by ID
router.get("/items/:id", check(permissions.itemRead.id), async (c) => {
  const id = c.req.param("id");
  const item = await itemService.getItem(id);
  if (!item) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(item);
});

// Create
router.post(
  "/items",
  check(permissions.itemCreate.id),
  validate(createItemSchema),
  async (c) => {
    const body = await c.req.json();
    const item = await itemService.createItem(body);
    return c.json(item, 201);
  }
);

// Update
router.put(
  "/items/:id",
  check(permissions.itemUpdate.id),
  validate(updateItemSchema),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const item = await itemService.updateItem(id, body);
    return c.json(item);
  }
);

// Delete
router.delete("/items/:id", check(permissions.itemDelete.id), async (c) => {
  const id = c.req.param("id");
  await itemService.deleteItem(id);
  return c.json({ success: true });
});
```

### Pagination

```typescript
router.get("/items", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = (page - 1) * limit;

  const items = await database
    .select()
    .from(schema.items)
    .limit(limit)
    .offset(offset);

  return c.json({ items, page, limit });
});
```

### Error Handling

```typescript
router.get("/items/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const item = await itemService.getItem(id);
    return c.json(item);
  } catch (err) {
    if (err instanceof ItemNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    logger.error("Unexpected error", { error: err });
    return c.json({ error: "Internal server error" }, 500);
  }
});
```

## Troubleshooting

### Plugin Not Loading

Check that:
1. Plugin is in `plugins/` directory
2. `package.json` has correct `name` and `exports`
3. Default export is a `BackendPlugin`

### Migrations Not Running

Check that:
1. `drizzle.config.ts` exists
2. Migrations are in `./drizzle/` directory
3. Schema is passed to `registerInit`

### Routes Not Working

Check that:
1. Router is from `coreServices.httpRouter`
2. Routes are defined in `init` function
3. URL path includes `/api/<pluginId>/`

### Permission Errors

Check that:
1. Permissions are registered via `registerPermissions`
2. Permission IDs match between common and backend
3. User has the required role/permission

## Next Steps

- [Frontend Plugin Development](./frontend-plugins.md)
- [Common Plugin Guidelines](./common-plugins.md)
- [Extension Points](./extension-points.md)
- [Versioned Configurations](./versioned-configs.md)
