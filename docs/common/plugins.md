---
---
# Common Plugin Guidelines

## Overview

Common plugins (e.g., `catalog-common`, `healthcheck-common`) are special plugin packages designed to define **contracts** and share types, schemas, and permissions between frontend and backend plugins. They contain code that is agnostic to the runtime environment and can safely be imported by both frontend and backend packages.

**Key Purpose**: Common packages define the **contract** for type-safe RPC communication using oRPC, serving as the single source of truth for API definitions.

## Dependency Architecture Rules

**Strict dependency isolation must be enforced:**

- **Frontend plugins** → May only depend on other frontend plugins OR common plugins
- **Backend plugins** → May only depend on other backend plugins OR common plugins
- **Common plugins** → May ONLY depend on other common plugins

This ensures clean separation of concerns and prevents runtime-specific code from leaking into shared packages.

## When to Create a Common Plugin

Create a common plugin when you need to:

1. **Define RPC Contracts**: Create type-safe oRPC contracts that both frontend and backend implement
2. **Share Permission Definitions**: Export permission constants that both frontend and backend need to reference
3. **Share Type Definitions**: Define types/interfaces used across frontend and backend (via Zod schemas)
4. **Share Validation Schemas**: Define Zod schemas for data validation and type inference
5. **Share Constants**: Export enums, configuration constants, or other shared values

## What Belongs in Common Plugins

### ✅ Safe to Include

- **RPC Contracts**: Type-safe contract definitions using `@orpc/contract`
  ```typescript
  import { oc } from "@orpc/contract";
  
  const _base = oc.$meta<Metadata>({});
  
  export const myContract = {
    getData: _base
      .meta({ permissions: [permissions.read.id] })
      .output(z.array(DataSchema)),
  };
  ```

- **Permission Definitions**: Type-safe permission objects and lists
  ```typescript
  export const permissions = {
    entityRead: {
      id: "entity.read",
      description: "Read entity data",
    },
  };
  ```

- **Zod Schemas**: For validation and type inference
  ```typescript
  export const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
  });
  ```

- **Type Definitions**: TypeScript types/interfaces (preferably inferred from Zod)
  ```typescript
  export type Item = z.infer<typeof ItemSchema>;
  ```

### ❌ Never Include

- Node.js-specific APIs (`fs`, `path`, server code)
- Browser-specific APIs (`window`, `document`)
- Database clients or ORM instances
- HTTP clients or server frameworks
- Backend business logic or services
- React components or hooks

## Quick Start

### 1. Scaffold Plugin with CLI

The fastest way to create a common plugin is using the CLI:

```bash
bun run create
```

**Interactive prompts:**
1. Select `common` as the plugin type
2. Enter your plugin name (e.g., `myfeature`)
3. Provide a description (optional)
4. Confirm to generate

This will create a complete common package with:
- ✅ Package configuration with required dependencies (`@orpc/contract`, `zod`)
- ✅ TypeScript configuration
- ✅ Permission definitions (read/manage pattern)
- ✅ Example Zod schemas with input/output types
- ✅ Complete oRPC contract with CRUD operations
- ✅ Barrel exports following circular dependency prevention
- ✅ Initial changeset for version management

**Generated structure:**
```
plugins/myfeature-common/
├── .changeset/
│   └── initial.md              # Version changeset
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── README.md                   # Documentation
└── src/
    ├── index.ts                # Barrel exports
    ├── permissions.ts          # Permission definitions
    ├── schemas.ts              # Zod schemas
    └── rpc-contract.ts         # oRPC contract
```

### 2. Install Dependencies

```bash
cd plugins/myfeature-common
bun install
```

### 3. Customize Your Contract

The generated plugin is a working example. Customize it for your domain:

#### Update Permissions

**src/permissions.ts:**

```typescript
import { createPermission } from "@checkmate/common";

export const permissions = {
  myFeatureRead: createPermission(
    "myfeature",
    "read",
    "Read myfeature data"
  ),
  myFeatureManage: createPermission(
    "myfeature",
    "manage",
    "Manage myfeature data"
  ),
};

export const permissionList = Object.values(permissions);
```

#### Define Your Schemas

**src/schemas.ts:**

```typescript
import { z } from "zod";

// Output schema (matches database)
export const MyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MyItem = z.infer<typeof MyItemSchema>;

// Input schema (omits id and timestamps)
export const CreateMyItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export type CreateMyItem = z.infer<typeof CreateMyItemSchema>;
```

#### Update Your Contract

**src/rpc-contract.ts:**

```typescript
import { oc } from "@orpc/contract";
import { z } from "zod";
import { MyItemSchema, CreateMyItemSchema } from "./schemas";
import { permissions } from "./permissions";

export interface MyFeatureMetadata {
  permissions?: string[];
}

const _base = oc.$meta<MyFeatureMetadata>({});

export const myFeatureContract = {
  getItems: _base
    .meta({ permissions: [permissions.myFeatureRead.id] })
    .output(z.array(MyItemSchema)),

  createItem: _base
    .meta({ permissions: [permissions.myFeatureManage.id] })
    .input(CreateMyItemSchema)
    .output(MyItemSchema),
};

export type MyFeatureContract = typeof myFeatureContract;
```

### 4. Verify

```bash
# Type check
bun run typecheck

# Lint
bun run lint
```

That's it! Your common package is ready to be consumed by backend and frontend plugins.

## The `@checkmate/common` Core Package

The `@checkmate/common` package is a special core package located in `core/common/` that provides shared type definitions and utilities used across the entire codebase. This is the foundation that all common plugins can depend on.

**What it contains:**
- Core type definitions (e.g., `Permission`, `PluginMetadata`)
- Permission utilities (`createPermission`, `qualifyPermissionId`)
- Fundamental interfaces used across plugins
- Zero runtime dependencies

**Who can use it:**
- ✅ All common plugins (including plugin-specific common packages like `catalog-common`)
- ✅ Backend API packages (like `@checkmate/backend-api`)
- ✅ Frontend API packages (like `@checkmate/frontend-api`)
- ✅ Backend and frontend plugins (when they need core types)

### Permission Types

```typescript
import type { Permission, ResourcePermission, PermissionAction } from "@checkmate/common";

// PermissionAction: "read" | "manage"

// Permission interface
interface Permission {
  id: string;
  description?: string;
  isAuthenticatedDefault?: boolean;
  isPublicDefault?: boolean;
}

// ResourcePermission extends Permission with resource and action
interface ResourcePermission extends Permission {
  resource: string;
  action: PermissionAction;
}
```

### createPermission

Creates a standardized resource permission with automatic ID generation:

```typescript
import { createPermission } from "@checkmate/common";

const permission = createPermission(
  "catalog",           // resource name
  "read",              // action ("read" | "manage")
  "Read catalog data", // optional description
  {                    // optional options
    isAuthenticatedDefault: true,  // assign to default "users" role
    isPublicDefault: false,        // assign to "anonymous" role
  }
);

// Result: { id: "catalog.read", resource: "catalog", action: "read", ... }
```

### qualifyPermissionId

Creates a fully-qualified permission ID by prefixing with the plugin ID. This is used internally by the RPC middleware and SignalService for authorization checks:

```typescript
import { qualifyPermissionId } from "@checkmate/common";
import { pluginMetadata } from "./plugin-metadata";
import { permissions } from "./permissions";

const qualifiedId = qualifyPermissionId(pluginMetadata, permissions.catalogRead);
// Result: "catalog.catalog.read" (format: ${pluginId}.${permission.id})
```

> **Note:** You typically don't need to call `qualifyPermissionId` directly. The platform handles permission namespacing automatically during registration and authorization checks.

This ensures that all packages can reference core types without creating circular dependencies or violating the architecture rules.

## Package Structure

A typical common plugin structure:

```
plugins/
  catalog-common/
    package.json
    tsconfig.json
    src/
      index.ts          # Barrel export
      permissions.ts    # Permission definitions
      schemas.ts        # Zod schemas and type definitions
      rpc-contract.ts   # oRPC contract definition
      constants.ts      # Shared constants (optional)
      utils.ts          # Pure utility functions (optional)
```

## Package Configuration

### Mandatory Dependencies

The `-common` package must have these dependencies to support oRPC contracts:

```json
{
  "dependencies": {
    "@checkmate/common": "workspace:*",
    "@orpc/contract": "^1.13.2",
    "zod": "^3.23.0"
  }
}
```

### package.json

```json
{
  "name": "@checkmate/catalog-common",
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

**Key points:**
- Use `workspace:*` for internal dependencies
- Only depend on `@checkmate/common` for shared type definitions like `Permission`
- Include `@orpc/contract` and `zod` for contract and schema definitions
- Do NOT depend on `@checkmate/backend-api`, `@checkmate/frontend-api`, or any runtime-specific packages
- Common plugins must maintain minimal dependencies to ensure they can be safely imported anywhere

### tsconfig.json

Common plugins should extend the shared common configuration:

```json
{
  "extends": "@checkmate/tsconfig/common.json",
  "include": ["src"]
}
```

See [Monorepo Tooling](../tooling/cli.md) for more information.

## Mandatory Project Structure

To prevent circular dependencies (which cause `ReferenceError: Cannot access 'X' before initialization` at runtime), follow this strict file layout for all `-common` packages:

### File Organization

1. **`src/permissions.ts`**: Define permissions using `createPermission`
2. **`src/schemas.ts`**: Define all Zod schemas and derive types
3. **`src/rpc-contract.ts`**: Define the oRPC contract
4. **`src/index.ts`**: Barrel file that exports everything

### The Golden Rule

**Internal package files (like `rpc-contract.ts`) MUST NEVER import from `./index`.** 

Doing so creates a circular loop when the barrel file also exports the contract, leading to uninitialized variable errors in tests and at runtime.

```typescript
// ✅ Good - Import from specific files
import { permissions } from "./permissions";
import { SystemSchema } from "./schemas";

// ❌ Bad - Creates circular dependency
import { permissions, SystemSchema } from "./index";
```

### Example Structure

**src/permissions.ts:**
```typescript
import { createPermission } from "@checkmate/common";

export const permissions = {
  catalogRead: createPermission(
    "catalog",
    "read",
    "Read catalog entities"
  ),
  catalogManage: createPermission(
    "catalog",
    "manage",
    "Manage catalog entities"
  ),
};

export const permissionList = Object.values(permissions);
```

**src/schemas.ts:**
```typescript
import { z } from "zod";

export const SystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type System = z.infer<typeof SystemSchema>;

export const CreateSystemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});
```

**src/rpc-contract.ts:**
```typescript
import { oc } from "@orpc/contract";
import { z } from "zod";
import { SystemSchema, CreateSystemSchema } from "./schemas"; // Direct import
import { permissions } from "./permissions"; // Direct import

// 1. Define metadata type (must match backend-api's PermissionMetadata structure)
export interface CatalogMetadata {
  permissions?: string[];
}

// 2. Create base builder with metadata support
const _base = oc.$meta<CatalogMetadata>({});

export const catalogContract = {
  getSystems: _base
    .meta({ permissions: [permissions.catalogRead.id] })
    .output(z.array(SystemSchema)),
  
  createSystem: _base
    .meta({ permissions: [permissions.catalogManage.id] })
    .input(CreateSystemSchema)
    .output(SystemSchema),
};

export type CatalogContract = typeof catalogContract;
```

**src/index.ts:**
```typescript
// Export permissions
export { permissions, permissionList } from "./permissions";

// Export schemas and types
export * from "./schemas";

// CRITICAL: Use explicit named re-exports for the contract
// Using export * can lead to silent export failures in some bundler configurations
export { catalogContract, type CatalogContract } from "./rpc-contract";
```

## Defining RPC Contracts

### Step 1: Define Domain Schemas

Define the core data models using Zod in `src/schemas.ts`. **Match database output types exactly** (using `z.date()` for timestamps and `.nullable()` where appropriate):

```typescript
import { z } from "zod";

export const SystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type System = z.infer<typeof SystemSchema>;
```

### Step 2: Define Input Schemas

**Best Practice**: **Always omit the `id` field** from creation schemas. The backend should generate unique identifiers.

```typescript
export const CreateSystemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["healthy", "degraded", "unhealthy"]).optional(),
});

export const UpdateSystemSchema = CreateSystemSchema.partial();
```

Using `z.enum` ensures frontend gets exact type inference for allowed values, avoiding unsafe type casting.

### Step 3: Define RPC Contract

Define your contract in `src/rpc-contract.ts` using the `oc` builder from `@orpc/contract`.

```typescript
import { oc } from "@orpc/contract";
import type { ProcedureMetadata } from "@checkmate/common";
import { z } from "zod";
import { SystemSchema, CreateSystemSchema, UpdateSystemSchema } from "./schemas";
import { permissions } from "./permissions";

// Use ProcedureMetadata from @checkmate/common for full auth control
const _base = oc.$meta<ProcedureMetadata>({});

export const catalogContract = {
  // User-only endpoints with permission requirements
  getSystems: _base
    .meta({ userType: "user", permissions: [permissions.catalogRead.id] })
    .output(z.array(SystemSchema)),
  
  getSystem: _base
    .meta({ userType: "user", permissions: [permissions.catalogRead.id] })
    .input(z.string())
    .output(SystemSchema),
  
  createSystem: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(CreateSystemSchema)
    .output(SystemSchema),
  
  // Public endpoint (no auth required)
  getPublicInfo: _base
    .meta({ userType: "anonymous" })
    .output(z.object({ version: z.string() })),

  // Service-to-service endpoint
  internalSync: _base
    .meta({ userType: "service" })
    .output(z.void()),
};

export type CatalogContract = typeof catalogContract;
```

## Contract-Based Auth Enforcement

The `ProcedureMetadata` interface from `@checkmate/common` provides declarative auth control:

```typescript
import type { ProcedureMetadata } from "@checkmate/common";

// ProcedureMetadata interface:
interface ProcedureMetadata {
  userType?: "anonymous" | "user" | "service" | "both";
  permissions?: string[];
}
```

### userType Options

| Value | Description |
|-------|-------------|
| `"anonymous"` | No authentication required (public endpoints) |
| `"user"` | Only real users (frontend authenticated) |
| `"service"` | Only services (backend-to-backend) |
| `"both"` | Either users or services, but must be authenticated (default) |

### Backend Enforcement

The `autoAuthMiddleware` from `@checkmate/backend-api` automatically enforces auth based on contract metadata:

```typescript
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext, type RealUser } from "@checkmate/backend-api";
import { catalogContract } from "@checkmate/catalog-common";

// Create implementer with context and auth middleware
const os = implement(catalogContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

// Auth and permissions are automatically enforced!
return os.router({
  getSystems: os.getSystems.handler(async ({ context }) => {
    // context.user is guaranteed to be RealUser by contract meta
    const userId = (context.user as RealUser).id;
    // ...
  }),
});
```

This approach:
- **Self-documenting**: Security requirements are visible in the contract
- **Automatic enforcement**: No manual middleware chaining needed
- **Type-safe**: Contract meta determines context.user type

### In Common Plugin (`catalog-common/src/permissions.ts`)

```typescript
import { createPermission } from "@checkmate/common";

export const permissions = {
  catalogRead: createPermission(
    "catalog",
    "read",
    "Read catalog entities",
    { isAuthenticatedDefault: true } // Auto-assigned to "users" role
  ),
  catalogManage: createPermission(
    "catalog",
    "manage",
    "Manage catalog entities"
  ),
};

// Export as array for backend registration
export const permissionList = Object.values(permissions);
```

> **Note**: Permissions with `isDefault: true` are automatically synced to the built-in "users" role on startup. See [Backend Plugin Development](../backend/plugins.md#default-permissions-and-the-users-role) for details.

### In Backend Plugin

```typescript
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext, type RealUser } from "@checkmate/backend-api";
import { catalogContract, permissionList } from "@checkmate/catalog-common";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // Register all permissions with the core
    env.registerPermissions(permissionList);

    env.registerInit({
      // ...
      init: async ({ rpc }) => {
        // Contract-based implementation with auto auth enforcement
        const os = implement(catalogContract)
          .$context<RpcContext>()
          .use(autoAuthMiddleware);
        
        const router = os.router({
          getSystems: os.getSystems.handler(async ({ context }) => {
            // Auth and permissions auto-enforced from contract meta
            const userId = (context.user as RealUser).id;
            // Implementation...
          }),
        });
        
        rpc.registerRouter(router);
      },
    });
  },
});
```

### In Frontend Plugin

```typescript
import { permissions } from "@checkmate/catalog-common";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";

export const CatalogConfigPage = () => {
  const permissionApi = useApi(permissionApiRef);
  
  // Use typed permission constants - no hardcoded strings!
  const canManage = permissionApi.usePermission(permissions.catalogManage.id);
  
  // ...
};
```

## Benefits of This Approach

1. **Type Safety**: Full end-to-end type safety from DB to frontend
2. **Runtime Validation**: Zod schemas provide runtime validation for all API inputs and outputs
3. **No Contract Drift**: Compile-time errors if backend implementation doesn't match contract
4. **Improved DX**: Auto-completion and type checking for all RPC calls
5. **Single Source of Truth**: Contract definition is the authoritative API specification
6. **Self-Documenting**: Permission requirements declared in contract metadata
7. **Refactoring Support**: IDE can find all usages when renaming
8. **No Duplication**: Eliminates hardcoded strings and duplicate type definitions

## Migrating Legacy Interfaces

In older parts of the codebase, contracts might be defined as simple TypeScript interfaces:

```typescript
// Legacy src/rpc-contract.ts
export interface MyLegacyContract {
  getData: (id: string) => Promise<Data[]>;
  updateData: (input: { id: string; data: Partial<Data> }) => Promise<Data>;
}
```

To migrate to the oRPC pattern:

1. **Define Zod Schemas**: Create schemas for `Data`, `CreateInput`, etc., in `src/schemas.ts`
2. **Rewrite with oc**: Use `oc.$meta<MyMetadata>({})` to create a base builder
   ```typescript
   const _base = oc.$meta<MyMetadata>({});

   export const myContract = {
     getData: _base
       .meta({ permissions: [permissions.myRead.id] })
       .input(z.string())
       .output(z.array(DataSchema)),

     updateData: _base
       .meta({ permissions: [permissions.myManage.id] })
       .input(z.object({ id: z.string(), data: DataSchema.partial() }))
       .output(DataSchema),
   };
   ```
3. **Update Type Exports**: Replace the `interface` with a `typeof` export
   ```typescript
   export type MyContract = typeof myContract;
   ```
4. **Update Router**: Refactor backend router to use `os.router()` and manual middleware
5. **Update Frontend**: Import the client type from the common package (`MyClient`)

## Troubleshooting Type Export Issues

If you encounter `TS2305: Module 'X' has no exported member 'Y'` in the frontend after restructuring a common package:

### 1. Verify Named Re-exports

Ensure `src/index.ts` uses **explicit named re-exports** instead of `export *`:

```typescript
// ✅ Good - Explicit named re-exports
export { myContract, type MyContract } from "./rpc-contract";

// ❌ Risky - Can fail to propagate types in complex monorepos
export * from "./rpc-contract";
```

This is the most common cause of `TS2305` in complex monorepos, as `export *` can fail to propagate types if the compiler doesn't trace the internal dependency tree correctly.

### 2. Remove Stale dist Folder

If a `dist` folder exists in your common package, **delete it**:

```bash
rm -rf dist
```

In source-resolving monorepos, a stale `dist` folder can shadow your updated source files, causing the compiler to see old types or no types at all.

### 3. Clear Consumer Cache

The consumer (frontend/backend) might have a stale TypeScript cache:

```bash
rm -rf tsconfig.tsbuildinfo node_modules/.cache
```

Restart the TypeScript Language Server or `bun run dev` process to pick up new declaration files.

### 4. Verify No Circular Dependencies

If a member remains missing despite being in `src/index.ts`, it is likely being silently omitted due to a circular dependency loop. **NEVER** import from the barrel file within its children.

## Naming Conventions

- **Package Name**: `@checkmate/<plugin>-common`
- **Permission IDs**: Use dot notation: `entity.read`, `incident.manage`
- **Permission Constants**: Use camelCase: `entityRead`, `incidentManage`
- **Contract Names**: Use camelCase suffix: `catalogContract`, `healthCheckContract`
- **Exports**: Always use barrel exports in `index.ts`

## Testing

Common plugins should be tested with unit tests that verify:
- Type definitions are correct
- Validation schemas work as expected
- Utility functions produce correct outputs
- Permission lists contain expected permissions
- Contract metadata is properly defined

Since common plugins have minimal runtime dependencies, they're easy to test:

```typescript
import { describe, expect, test } from "bun:test";
import { permissions, permissionList } from "./permissions";
import { SystemSchema } from "./schemas";

describe("Permissions", () => {
  test("permission list contains all permissions", () => {
    expect(permissionList).toHaveLength(2);
  });

  test("permission IDs are correctly formatted", () => {
    expect(permissions.catalogRead.id).toBe("catalog.read");
  });
});

describe("Schemas", () => {
  test("SystemSchema validates correct data", () => {
    const result = SystemSchema.safeParse({
      id: "sys-1",
      name: "Test System",
      status: "healthy",
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    expect(result.success).toBe(true);
  });
  
  test("SystemSchema rejects invalid status", () => {
    const result = SystemSchema.safeParse({
      id: "sys-1",
      name: "Test System",
      status: "invalid",
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    expect(result.success).toBe(false);
  });
});
```

## Next Steps

- [Backend Plugin Development](../backend/plugins.md) - Implement contracts in backend routers
- [Frontend Plugin Development](../frontend/plugins.md) - Consume contracts in frontend clients
- [Extension Points](../frontend/extension-points.md)
- [Versioned Configurations](../backend/versioned-configs.md)
