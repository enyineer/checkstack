# Common Plugin Guidelines

## Overview

Common plugins (e.g., `catalog-common`, `auth-common`) are special plugin packages designed to share code, types, and constants between frontend and backend plugins. They contain code that is agnostic to the runtime environment and can safely be imported by both frontend and backend packages.

## When to Create a Common Plugin

Create a common plugin when you need to:

1. **Share Permission Definitions**: Export permission constants that both frontend and backend need to reference
2. **Share Type Definitions**: Define types/interfaces used across frontend and backend (e.g., API request/response types)
3. **Share Constants**: Export enums, configuration constants, or other shared values
4. **Share Utilities**: Include pure functions that don't depend on runtime-specific APIs (no DOM, no Node.js APIs)

## What Belongs in Common Plugins

### ✅ Safe to Include

- **Permission Definitions**: Type-safe permission objects and lists
  ```typescript
  export const permissions = {
    entityRead: {
      id: "entity.read",
      description: "Read Systems and Groups",
    },
    // ...
  } satisfies Record<string, Permission>;
  ```

- **Type Definitions**: Shared interfaces and types
  ```typescript
  export interface System {
    id: string;
    name: string;
  }
  ```

- **Validation Schemas**: Zod schemas for shared data structures
  ```typescript
  export const systemSchema = z.object({
    id: z.string(),
    name: z.string(),
  });
  ```

- **Pure Utility Functions**: Functions with no side effects or runtime dependencies
  ```typescript
  export function formatSystemId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "-");
  }
  ```

- **Constants and Enums**:
  ```typescript
  export const API_VERSION = "v1";
  export enum SystemStatus {
    Healthy = "healthy",
    Degraded = "degraded",
    Down = "down",
  }
  ```

### ❌ Do NOT Include

- **React Components**: These belong in `*-react` or `*-frontend` plugins
- **Hono Routers**: These belong in `*-backend` plugins
- **Drizzle Schemas**: These belong in `*-backend` plugins
- **Node.js-specific APIs**: Use `*-node` plugins instead
- **Browser-specific APIs**: Use `*-frontend` or `*-react` plugins instead
- **Database Logic**: Keep in `*-backend` plugins
- **HTTP Request Logic**: Keep in appropriate frontend/backend plugins

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
      types.ts          # Shared type definitions
      schemas.ts        # Zod validation schemas (optional)
      constants.ts      # Shared constants (optional)
      utils.ts          # Pure utility functions (optional)
```

## Package Configuration

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
    "@checkmate/backend-api": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

**Key points:**
- Use `workspace:*` for internal dependencies
- Only depend on `@checkmate/backend-api` for type definitions like `Permission`
- Do NOT depend on `@checkmate/frontend` or runtime-specific packages

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "declaration": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
```

## Permission Export Pattern

### In Common Plugin (`catalog-common/src/permissions.ts`)

```typescript
import { Permission } from "@checkmate/backend-api";

export const permissions = {
  entityRead: {
    id: "entity.read",
    description: "Read Systems and Groups",
  },
  entityCreate: {
    id: "entity.create",
    description: "Create Systems and Groups",
  },
  // ... more permissions
} satisfies Record<string, Permission>;

// Export as array for backend registration
export const permissionList = Object.values(permissions);
```

### In Backend Plugin

```typescript
import { permissionList, permissions } from "@checkmate/catalog-common";

export default createBackendPlugin({
  pluginId: "catalog-backend",
  register(env) {
    // Register all permissions with the core
    env.registerPermissions(permissionList);

    env.registerInit({
      // ...
      init: async ({ router, check }) => {
        // Use typed permission constants
        router.get("/entities", check(permissions.entityRead.id), async (c) => {
          // ...
        });
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

## Benefits

1. **Type Safety**: Compile-time validation of permission strings
2. **Single Source of Truth**: Permission definitions in one place
3. **Refactoring Support**: IDE can find all usages when renaming
4. **Autocomplete**: IDE provides suggestions for available permissions
5. **No Duplication**: Eliminates hardcoded permission strings scattered across files
6. **Cross-Plugin Sharing**: Other plugins can import and use the same permissions

## Naming Conventions

- **Package Name**: `@checkmate/<plugin>-common`
- **Permission IDs**: Use dot notation: `entity.read`, `incident.manage`
- **Permission Constants**: Use camelCase: `entityRead`, `incidentManage`
- **Exports**: Always use barrel exports in `index.ts`

## Testing

Common plugins should be tested with unit tests that verify:
- Type definitions are correct
- Validation schemas work as expected
- Utility functions produce correct outputs
- Permission lists contain expected permissions

Since common plugins have no runtime dependencies, they're easy to test:

```typescript
import { describe, expect, test } from "bun:test";
import { permissions, permissionList } from "./permissions";

describe("Permissions", () => {
  test("permission list contains all permissions", () => {
    expect(permissionList).toHaveLength(7);
  });

  test("permission IDs are correctly formatted", () => {
    expect(permissions.entityRead.id).toBe("entity.read");
  });
});
```
