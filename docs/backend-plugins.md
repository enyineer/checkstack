# Backend Plugin Development Guide

## Overview

Backend plugins provide type-safe RPC APIs, business logic, database schemas, and integration with external services. They are built using **oRPC** for contract implementation, **Drizzle** for database access, and **Zod** for validation.

The backend implements contracts defined in `-common` packages, ensuring end-to-end type safety from database to frontend.

## Quick Start

### 1. Create Plugin Structure

```bash
mkdir -p plugins/myplugin-{common,backend}/src
```

### 2. Initialize Common Package

Create the common package first to define your contract.

**plugins/myplugin-common/package.json:**

```json
{
  "name": "@checkmate/myplugin-common",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts"
    }
  },
  "dependencies": {
    "@checkmate/common": "workspace:*",
    "@orpc/contract": "^1.13.2",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

### 3. Define Permissions

**plugins/myplugin-common/src/permissions.ts:**

```typescript
import { createPermission } from "@checkmate/common";

export const permissions = {
  itemRead: createPermission({
    id: "item.read",
    description: "Read items",
  }),
  itemManage: createPermission({
    id: "item.manage",
    description: "Manage items",
  }),
};

export const permissionList = Object.values(permissions);
```

### 4. Define Schemas

**plugins/myplugin-common/src/schemas.ts:**

```typescript
import { z } from "zod";

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Item = z.infer<typeof ItemSchema>;

export const CreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export const UpdateItemSchema = CreateItemSchema.partial();
```

### 5. Define Contract

**plugins/myplugin-common/src/rpc-contract.ts:**

```typescript
import { oc } from "@orpc/contract";
import { z } from "zod";
import { ItemSchema, CreateItemSchema, UpdateItemSchema } from "./schemas";
import { permissions } from "./permissions";

// Define metadata type for type-safe permission declarations
export interface MyPluginMetadata {
  permissions?: string[];
}

// Create base builder with metadata support
const _base = oc.$meta<MyPluginMetadata>({});

export const myPluginContract = {
  getItems: _base
    .meta({ permissions: [permissions.itemRead.id] })
    .output(z.array(ItemSchema)),

  getItem: _base
    .meta({ permissions: [permissions.itemRead.id] })
    .input(z.string())
    .output(ItemSchema),

  createItem: _base
    .meta({ permissions: [permissions.itemManage.id] })
    .input(CreateItemSchema)
    .output(ItemSchema),

  updateItem: _base
    .meta({ permissions: [permissions.itemManage.id] })
    .input(z.object({ id: z.string(), data: UpdateItemSchema }))
    .output(ItemSchema),

  deleteItem: _base
    .meta({ permissions: [permissions.itemManage.id] })
    .input(z.string())
    .output(z.void()),
};

export type MyPluginContract = typeof myPluginContract;
```

### 6. Export from Common

**plugins/myplugin-common/src/index.ts:**

```typescript
// Export permissions
export { permissions, permissionList } from "./permissions";

// Export schemas and types
export * from "./schemas";

// Export contract - use explicit named re-exports to avoid bundler issues
export { myPluginContract, type MyPluginContract } from "./rpc-contract";
```

### 7. Initialize Backend Package

**plugins/myplugin-backend/package.json:**

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
    "zod": "^3.23.0"
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

### 8. Define Database Schema

**plugins/myplugin-backend/src/schema.ts:**

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### 9. Create Router Implementation

**plugins/myplugin-backend/src/router.ts:**

```typescript
import {
  os,
  authedProcedure,
  permissionMiddleware,
} from "@checkmate/backend-api";
import { permissions, CreateItemSchema, UpdateItemSchema } from "@checkmate/myplugin-common";
import { ItemService } from "./service";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { z } from "zod";

// Create permission middleware instances
const itemRead = permissionMiddleware(permissions.itemRead.id);
const itemManage = permissionMiddleware(permissions.itemManage.id);

export const createMyPluginRouter = (
  database: NodePgDatabase<typeof schema>
) => {
  const service = new ItemService(database);

  return os.router({
    getItems: authedProcedure
      .use(itemRead)
      .handler(async () => {
        return await service.getItems();
      }),

    getItem: authedProcedure
      .use(itemRead)
      .input(z.string())
      .handler(async ({ input }) => {
        const item = await service.getItem(input);
        if (!item) throw new Error("Item not found");
        return item;
      }),

    createItem: authedProcedure
      .use(itemManage)
      .input(CreateItemSchema)
      .handler(async ({ input }) => {
        return await service.createItem(input);
      }),

    updateItem: authedProcedure
      .use(itemManage)
      .input(z.object({ id: z.string(), data: UpdateItemSchema }))
      .handler(async ({ input }) => {
        const item = await service.updateItem(input.id, input.data);
        if (!item) throw new Error("Item not found");
        return item;
      }),

    deleteItem: authedProcedure
      .use(itemManage)
      .input(z.string())
      .handler(async ({ input }) => {
        await service.deleteItem(input);
      }),
  });
};

export type MyPluginRouter = ReturnType<typeof createMyPluginRouter>;
```

### 10. Create Service Layer

**plugins/myplugin-backend/src/service.ts:**

```typescript
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export class ItemService {
  constructor(private database: NodePgDatabase<typeof schema>) {}

  async getItems() {
    return await this.database.select().from(schema.items);
  }

  async getItem(id: string) {
    const [item] = await this.database
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, id));
    return item;
  }

  async createItem(data: { name: string; description?: string }) {
    const [item] = await this.database
      .insert(schema.items)
      .values({
        id: uuidv4(), // Generate ID server-side
        name: data.name,
        description: data.description ?? null,
      })
      .returning();
    return item;
  }

  async updateItem(id: string, data: Partial<{ name: string; description?: string }>) {
    const [item] = await this.database
      .update(schema.items)
      .set({
        ...data,
        description: data.description ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.items.id, id))
      .returning();
    return item;
  }

  async deleteItem(id: string) {
    await this.database.delete(schema.items).where(eq(schema.items.id, id));
  }
}
```

### 11. Create Plugin Entry Point

**plugins/myplugin-backend/src/index.ts:**

```typescript
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissionList } from "@checkmate/myplugin-common";
import * as schema from "./schema";
import { createMyPluginRouter } from "./router";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

export default createBackendPlugin({
  pluginId: "myplugin-backend",
  register(env) {
    // Register permissions
    env.registerPermissions(permissionList);

    // Register initialization
    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc, logger }) => {
        logger.info("Initializing MyPlugin Backend...");

        // Create router with plugin-scoped database
        const router = createMyPluginRouter(
          database as NodePgDatabase<typeof schema>
        );

        // Register router using the plugin ID
        rpc.registerRouter("myplugin-backend", router);

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
  { id: "item.manage", description: "Manage items" },
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
    rpc: coreServices.rpc,
    logger: coreServices.logger,
  },
  init: async ({ database, rpc, logger }) => {
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

### `coreServices.rpc`

The RPC service for registering oRPC routers.

**Routers are automatically mounted at:** `/api/<pluginId>/`

```typescript
const router = createMyPluginRouter(database);
rpc.registerRouter("myplugin-backend", router);
// Procedures accessible at: /api/myplugin-backend/<procedureName>
```

> **Critical**: The registration name must match the plugin ID exactly for frontend clients to work correctly.

### `coreServices.logger`

Structured logging service.

```typescript
logger.info("Informational message");
logger.warn("Warning message");
logger.error("Error message");
logger.debug("Debug message");
```

## Contract Implementation Pattern

### 1. Define Contract in Common Package

Contracts are defined in the `-common` package using `@orpc/contract`. See [Common Plugin Guidelines](./common-plugins.md) for details.

### 2. Implement Contract in Backend

The backend router implements the contract using `os.router()`:

```typescript
import { os, authedProcedure, permissionMiddleware } from "@checkmate/backend-api";
import { permissions } from "@checkmate/myplugin-common";

const itemRead = permissionMiddleware(permissions.itemRead.id);
const itemManage = permissionMiddleware(permissions.itemManage.id);

export const createMyPluginRouter = (database: Database) => {
  return os.router({
    // Each procedure name must match the contract
    getItems: authedProcedure
      .use(itemRead)
      .handler(async () => {
        // Implementation
      }),
  });
};
```

### 3. Security Enforcement

The project uses **explicit permission enforcement**:

- **Contracts document** required permissions via `.meta({ permissions: [...] })`
- **Backend enforces** permissions via `authedProcedure.use(permissionMiddleware(...))`

This pattern ensures security is auditable and visible in the router implementation.

```typescript
// In contract (documentation):
getItems: _base
  .meta({ permissions: [permissions.itemRead.id] })
  .output(z.array(ItemSchema)),

// In router (enforcement):
getItems: authedProcedure
  .use(itemRead) // Explicit enforcement
  .handler(async () => { /* ... */ }),
```

### 4. Base Procedures

**`authedProcedure`**: Ensures the user is authenticated (has a valid session).

```typescript
import { authedProcedure } from "@checkmate/backend-api";

getItems: authedProcedure
  .handler(async ({ context }) => {
    // context.user is guaranteed to exist
    console.log(`Request from user: ${context.user.id}`);
  });
```

**Permission Middleware**: Ensures the user has the required permission.

```typescript
const itemRead = permissionMiddleware(permissions.itemRead.id);

getItems: authedProcedure
  .use(itemRead)
  .handler(async ({ context }) => {
    // User is authenticated AND has itemRead permission
  });
```

### 5. Handler Type Inference

oRPC automatically infers types from the procedure chain. **Do not** add explicit type annotations to handler parameters.

```typescript
// ✅ Good - Let oRPC infer types
.handler(async ({ input, context }) => {
  // input and context are automatically typed
})

// ❌ Bad - Don't add complex type annotations
.handler(async ({ input, context }: { input: SomeType; context: SomeContext }) => {
  // This breaks inference
})
```

## Database Schema

### Define Schema

**src/schema.ts:**

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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

## Router Factory Pattern

Routers should be created as factory functions that accept the plugin-scoped database instance:

```typescript
export const createMyPluginRouter = (
  database: NodePgDatabase<typeof schema>
) => {
  return os.router({
    // Procedures use the captured database, NOT context.db
  });
};
```

**Why?** The `context.db` in oRPC handlers is the admin database pool. Plugin tables are isolated in schemas like `plugin_<id>`, so using `context.db` will result in "relation does not exist" errors.

**Solution:** Capture the plugin-scoped database via the factory pattern and use it in all handlers.

## Dependency Injection

### Declaring Dependencies

```typescript
env.registerInit({
  deps: {
    rpc: coreServices.rpc,
    logger: coreServices.logger,
    myService: myServiceRef,
  },
  init: async ({ database, rpc, logger, myService }) => {
    // All dependencies are resolved and typed
  },
});
```

### Type Safety

Dependencies are fully typed. TypeScript will error if:
- You declare a dependency that doesn't exist
- You use a dependency with the wrong type
- You forget to declare a dependency you use

## Testing

### Router Tests

**src/router.test.ts:**

```typescript
import { describe, it, expect, mock } from "bun:test";
import { createMyPluginRouter } from "./router";
import { createMockRpcContext } from "@checkmate/backend-api";
import { call } from "@orpc/server";

describe("MyPlugin Router", () => {
  // 1. Create a mock database instance
  const mockDb = {
    select: mock().mockReturnValue({
      from: mock().mockReturnValue([
        { id: "1", name: "Test Item", description: null },
      ]),
    }),
  } as any;

  // 2. Initialize the router with the mock database
  const router = createMyPluginRouter(mockDb);

  it("getItems returns items", async () => {
    const context = createMockRpcContext({
      user: { id: "test-user", roles: ["admin"] },
    });

    // 3. Use 'call' from @orpc/server to execute the procedure
    const result = await call(router.getItems, undefined, { context });

    expect(Array.isArray(result)).toBe(true);
    expect(mockDb.select).toHaveBeenCalled();
  });
});
```

### Service Tests

**src/service.test.ts:**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { ItemService } from "./service";

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

## Best Practices

### 1. Use Services for Business Logic

Don't put business logic directly in procedure handlers:

```typescript
// ❌ Bad
getItems: authedProcedure.handler(async () => {
  const items = await database.select().from(schema.items);
  return items;
});

// ✅ Good
getItems: authedProcedure.handler(async () => {
  return await itemService.getItems();
});
```

### 2. Generate IDs Server-Side

Never require IDs from the frontend. Generate them in the service layer:

```typescript
async createItem(data: NewItem) {
  const [item] = await this.database
    .insert(schema.items)
    .values({
      id: uuidv4(), // Generate ID internally
      ...data
    })
    .returning();
  return item;
}
```

### 3. Use Type Assertions for JSON Fields

Drizzle's `json()` columns infer to `unknown`. Use type assertions to bridge to your contract types:

```typescript
.handler(async () => {
  const result = await service.getItems();
  return result as unknown as Array<typeof result[number] & {
    metadata: Record<string, unknown> | null
  }>;
});
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

## Troubleshooting

### 404 Errors

If your oRPC endpoints return 404:

1. Verify router is registered with `rpc.registerRouter`
2. Ensure registration name exactly matches the plugin ID
3. Check plugin initialization is executed (check backend logs)
4. Verify frontend client uses matching plugin ID

### 500 Errors

If your oRPC endpoints return 500 after routing is fixed:

1. **Missing Database Migrations**: Check backend logs for "relation does not exist"
2. **Context Database**: Ensure handlers use the captured plugin-scoped database, NOT `context.db`
3. **Validation Errors**: Check that service layer returns data matching the contract output schema

### Type Errors in Handlers

If TypeScript complains about handler types:

1. Remove explicit type annotations from handler parameters
2. Let oRPC infer types from the procedure chain
3. Ensure input/output schemas match the contract definition

## Next Steps

- [Frontend Plugin Development](./frontend-plugins.md)
- [Common Plugin Guidelines](./common-plugins.md)
- [Extension Points](./extension-points.md)
- [Versioned Configurations](./versioned-configs.md)
