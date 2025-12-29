# Frontend Plugin Development Guide

## Overview

Frontend plugins provide UI components, pages, routing, and client-side services. They are built using **React**, **React Router**, **ShadCN UI**, and **Vite**.

Frontend plugins consume **oRPC contracts** defined in `-common` packages, enabling type-safe RPC communication with the backend.

## Quick Start

### 1. Create Plugin Structure

```bash
mkdir -p plugins/myplugin-frontend/src
cd plugins/myplugin-frontend
```

### 2. Initialize package.json

```json
{
  "name": "@checkmate/myplugin-frontend",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.tsx"
    }
  },
  "dependencies": {
    "@checkmate/frontend-api": "workspace:*",
    "@checkmate/common": "workspace:*",
    "@checkmate/myplugin-common": "workspace:*",
    "@checkmate/ui": "workspace:*",
    "react": "^18.3.1",
    "react-router-dom": "^7.1.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "typescript": "^5.7.2"
  }
}
```

```bash
bun run sync
```

See [Monorepo Tooling](./monorepo-tooling.md) for details on shared configurations.

### 3. Define API Interface (Contract-Based)

**src/api.ts:**

```typescript
import { createApiRef } from "@checkmate/frontend-api";
import type { ContractRouterClient } from "@orpc/contract";
import { myPluginContract } from "@checkmate/myplugin-common";

// Re-export types for convenience
export type { Item, CreateItem, UpdateItem } from "@checkmate/myplugin-common";

// Derive API type from contract - no manual interface definitions!
export type MyPluginApi = ContractRouterClient<typeof myPluginContract>;

export const myPluginApiRef = createApiRef<MyPluginApi>("myplugin-api");
```

**Key Concept**: The frontend API type is **derived from the contract**, ensuring compile-time safety. If the backend contract changes, TypeScript will immediately flag any incompatible frontend code.

### 4. Create Plugin Entry Point

**src/index.tsx:**

```typescript
import {
  createFrontendPlugin,
  rpcApiRef,
} from "@checkmate/frontend-api";
import { myPluginApiRef } from "./api";
import { ItemListPage } from "./components/ItemListPage";
import { ItemDetailPage } from "./components/ItemDetailPage";
import { ItemConfigPage } from "./components/ItemConfigPage";
import { permissions } from "@checkmate/myplugin-common";
import { ListIcon } from "lucide-react";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  
  // Register client API using oRPC
  apis: [
    {
      ref: myPluginApiRef,
      factory: (deps) => {
        const rpcApi = deps.get(rpcApiRef);
        // Create type-safe client for the backend plugin
        return rpcApi.forPlugin<MyPluginApi>("myplugin-backend");
      },
    },
  ],
  
  // Register routes
  routes: [
    {
      path: "/items",
      element: <ItemListPage />,
    },
    {
      path: "/items/:id",
      element: <ItemDetailPage />,
    },
    {
      path: "/items/config",
      element: <ItemConfigPage />,
      permission: permissions.itemManage.id,
    },
  ],
  
  // Register navigation items
  navItems: [
    {
      title: "Items",
      path: "/items",
      icon: <ListIcon />,
    },
  ],
  
  // Register UI extensions (optional)
  extensions: [
    {
      id: "myplugin.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: MyUserMenuItems,
    },
  ],
});

export * from "./api";
```

## Plugin Configuration

### `createFrontendPlugin(config)`

Creates a frontend plugin with the specified configuration.

**Parameters:**

#### `name` (required)

Unique identifier for the plugin.

```typescript
name: "myplugin-frontend"
```

#### `apis` (optional)

Register client-side APIs that components can use.

```typescript
apis: [
  {
    ref: myPluginApiRef,
    factory: (deps) => {
      const rpcApi = deps.get(rpcApiRef);
      return rpcApi.forPlugin<MyPluginApi>("myplugin-backend");
    },
  },
]
```

#### `routes` (optional)

Register pages and their routes.

```typescript
routes: [
  {
    path: "/items",
    element: <ItemListPage />,
    title: "Items", // Optional: page title
    permission: permissions.itemRead.id, // Optional: required permission
  },
]
```

#### `navItems` (optional)

Register navigation menu items.

```typescript
navItems: [
  {
    title: "Items",
    path: "/items",
    icon: <ListIcon />, // Optional: icon component
  },
]
```

#### `extensions` (optional)

Register components to inject into extension slots.

```typescript
extensions: [
  {
    id: "myplugin.user-menu.items",
    slotId: SLOT_USER_MENU_ITEMS,
    component: MyUserMenuItems,
  },
]
```

## Contract-Based Client API Pattern

The frontend consumes contracts defined in `-common` packages to get type-safe RPC clients.

### Step 1: Import Contract and Derive Types

**src/api.ts:**

```typescript
import { createApiRef } from "@checkmate/frontend-api";
import type { ContractRouterClient } from "@orpc/contract";
import { myPluginContract } from "@checkmate/myplugin-common";

// Re-export types from common for convenience
export type { Item, CreateItem, UpdateItem } from "@checkmate/myplugin-common";

// Derive the API client type from the contract
export type MyPluginApi = ContractRouterClient<typeof myPluginContract>;

export const myPluginApiRef = createApiRef<MyPluginApi>("myplugin-api");
```

**Why `ContractRouterClient`?**
- It derives the client type from the oRPC contract
- Provides compile-time type safety for all RPC calls
- Eliminates manual interface definitions that can drift from the backend

### Step 2: Register API Factory

**src/index.tsx:**

```typescript
import { rpcApiRef } from "@checkmate/frontend-api";
import { myPluginApiRef, type MyPluginApi } from "./api";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  
  apis: [
    {
      ref: myPluginApiRef,
      factory: (deps) => {
        const rpcApi = deps.get(rpcApiRef);
        // Create a client for the backend plugin
        // The plugin ID must match the backend router registration name
        return rpcApi.forPlugin<MyPluginApi>("myplugin-backend");
      },
    },
  ],
});
```

**Critical**: The plugin ID passed to `forPlugin` must exactly match the name used in the backend's `rpc.registerRouter()` call.

### Step 3: Use in Components

```typescript
import { useApi } from "@checkmate/frontend-api";
import { myPluginApiRef } from "../api";

export const ItemListPage = () => {
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    // Type-safe RPC call - no manual URL construction!
    api.getItems().then(setItems);
  }, [api]);

  const handleCreate = async (data: CreateItem) => {
    // Input types are automatically inferred from the contract
    const newItem = await api.createItem(data);
    setItems([...items, newItem]);
  };

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
};
```

### Benefits of Contract-Based Clients

1. **No Manual URL Construction**: RPC procedures are called like functions
2. **Full Type Safety**: Input and output types inferred from contract
3. **Auto-completion**: IDE suggests available procedures and their parameters
4. **Compile-Time Errors**: Contract changes immediately break incompatible frontend code
5. **No Duplication**: Single source of truth for API definitions

## Core APIs

The core provides these APIs for use in components:

### `rpcApiRef`

The oRPC client factory for creating type-safe plugin clients.

```typescript
const rpcApi = useApi(rpcApiRef);

// Create a client for a specific backend plugin
const client = rpcApi.forPlugin<MyPluginApi>("myplugin-backend");
```

### `permissionApiRef`

Check user permissions.

```typescript
const permissionApi = useApi(permissionApiRef);

const canManage = permissionApi.usePermission(permissions.itemManage.id);

if (canManage.allowed) {
  // Show management UI
}
```

### `authApiRef`

Access authentication state.

```typescript
const authApi = useApi(authApiRef);

const session = authApi.useSession();

if (session.user) {
  // User is logged in
}
```

## Permission Gating

### Route-Level Permissions

```typescript
import { permissions } from "@checkmate/myplugin-common";

routes: [
  {
    path: "/items/config",
    element: <ItemConfigPage />,
    permission: permissions.itemManage.id,
  },
]
```

Users without the permission will see an "Access Denied" page.

### Component-Level Permissions

```typescript
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { permissions } from "@checkmate/myplugin-common";

export const ItemListPage = () => {
  const permissionApi = useApi(permissionApiRef);
  const canCreate = permissionApi.usePermission(permissions.itemCreate.id);

  return (
    <div>
      <h1>Items</h1>
      {canCreate.allowed && (
        <Button onClick={handleCreate}>Create Item</Button>
      )}
    </div>
  );
};
```

### Permission Loading State

```typescript
const permission = permissionApi.usePermission(permissions.itemManage.id);

if (permission.loading) {
  return <LoadingSpinner />;
}

if (!permission.allowed) {
  return <PermissionDenied />;
}

return <ItemConfigPage />;
```

## UI Components

Use components from `@checkmate/ui` for consistent styling:

```typescript
import {
  Button,
  Card,
  Input,
  Label,
  Table,
  Dialog,
  Select,
  Checkbox,
} from "@checkmate/ui";

export const ItemForm = () => {
  return (
    <Card>
      <Label htmlFor="name">Name</Label>
      <Input id="name" placeholder="Enter name" />
      
      <Label htmlFor="description">Description</Label>
      <Input id="description" placeholder="Enter description" />
      
      <Button type="submit">Save</Button>
    </Card>
  );
};
```

## Extension Slots

### Available Slots

```typescript
import {
  SLOT_USER_MENU_ITEMS,
  SLOT_DASHBOARD_WIDGETS,
} from "@checkmate/common";
```

### Injecting into Slots

```typescript
extensions: [
  {
    id: "myplugin.user-menu.items",
    slotId: SLOT_USER_MENU_ITEMS,
    component: MyUserMenuItems,
  },
]
```

### Example: User Menu Items

```typescript
import { DropdownMenuItem } from "@checkmate/ui";
import { Link } from "react-router-dom";

export const MyUserMenuItems = () => {
  return (
    <>
      <DropdownMenuItem asChild>
        <Link to="/items/config">Item Settings</Link>
      </DropdownMenuItem>
    </>
  );
};
```

## Routing

### Navigation

```typescript
import { Link, useNavigate } from "react-router-dom";

// Using Link
<Link to="/items/123">View Item</Link>

// Using navigate
const navigate = useNavigate();
navigate("/items/123");
```

### Route Parameters

```typescript
import { useParams } from "react-router-dom";

export const ItemDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  
  // Use id to fetch item
};
```

### Query Parameters

```typescript
import { useSearchParams } from "react-router-dom";

export const ItemListPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const page = searchParams.get("page") || "1";
  const filter = searchParams.get("filter") || "";
  
  const handlePageChange = (newPage: number) => {
    setSearchParams({ page: newPage.toString(), filter });
  };
};
```

## State Management

### Local State

```typescript
import { useState } from "react";

export const ItemForm = () => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  return (
    <form>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} />
    </form>
  );
};
```

### Server State with RPC

```typescript
import { useEffect, useState } from "react";
import { useApi } from "@checkmate/frontend-api";
import { myPluginApiRef, type Item } from "../api";

export const ItemListPage = () => {
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    api
      .getItems()
      .then(setItems)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return <ItemList items={items} />;
};
```

## Forms

### Basic Form

```typescript
import { useState } from "react";
import { Button, Input, Label } from "@checkmate/ui";

export const ItemForm = ({ onSubmit }: { onSubmit: (data: ItemData) => void }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, description });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      
      <div>
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      
      <Button type="submit">Save</Button>
    </form>
  );
};
```

### Form with Validation

```typescript
import { z } from "zod";

const itemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export const ItemForm = () => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = itemSchema.safeParse({ name, description });
    
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0].toString()] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }
    
    onSubmit(result.data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <span className="text-red-500">{errors.name}</span>}
      </div>
    </form>
  );
};
```

## Common Patterns

### List Page with RPC

```typescript
import { useApi } from "@checkmate/frontend-api";
import { myPluginApiRef, type Item } from "../api";

export const ItemListPage = () => {
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  const handleDelete = async (id: string) => {
    await api.deleteItem(id);
    setItems(items.filter(item => item.id !== id));
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Items</h1>
        <Button onClick={() => navigate("/items/new")}>Create Item</Button>
      </div>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.name}</TableCell>
              <TableCell>{item.description}</TableCell>
              <TableCell>
                <Button onClick={() => navigate(`/items/${item.id}`)}>
                  View
                </Button>
                <Button onClick={() => handleDelete(item.id)} variant="destructive">
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
```

### Detail Page

```typescript
export const ItemDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const api = useApi(myPluginApiRef);
  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    if (id) {
      api.getItem(id).then(setItem);
    }
  }, [id, api]);

  if (!item) return <LoadingSpinner />;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{item.name}</h1>
      <p>{item.description}</p>
    </div>
  );
};
```

### Create/Edit Page

```typescript
export const ItemEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const api = useApi(myPluginApiRef);
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    if (id) {
      api.getItem(id).then(setItem);
    }
  }, [id, api]);

  const handleSubmit = async (data: CreateItem) => {
    if (id) {
      await api.updateItem({ id, data });
    } else {
      await api.createItem(data);
    }
    navigate("/items");
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">
        {id ? "Edit Item" : "Create Item"}
      </h1>
      <ItemForm initialData={item} onSubmit={handleSubmit} />
    </div>
  );
};
```

## Best Practices

### 1. Use TypeScript

Always type your components and APIs:

```typescript
interface ItemListProps {
  items: Item[];
  onItemClick: (id: string) => void;
}

export const ItemList: React.FC<ItemListProps> = ({ items, onItemClick }) => {
  // ...
};
```

### 2. Extract Reusable Components

```typescript
// components/ItemCard.tsx
export const ItemCard = ({ item }: { item: Item }) => {
  return (
    <Card>
      <h3>{item.name}</h3>
      <p>{item.description}</p>
    </Card>
  );
};
```

### 3. Handle Loading and Error States

```typescript
if (loading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;
if (!data) return <EmptyState />;
```

### 4. Use Semantic HTML

```typescript
<main>
  <header>
    <h1>Items</h1>
  </header>
  <section>
    <ItemList items={items} />
  </section>
</main>
```

### 5. Accessibility

```typescript
<Button aria-label="Delete item">
  <TrashIcon />
</Button>

<Input
  id="name"
  aria-describedby="name-error"
  aria-invalid={!!errors.name}
/>
```

### 6. Leverage Contract Types

Import types from the common package instead of redefining them:

```typescript
// ✅ Good - Use contract types
import type { Item, CreateItem } from "@checkmate/myplugin-common";

// ❌ Bad - Duplicate type definitions
interface Item {
  id: string;
  name: string;
  // ...
}
```

## Testing

### Component Tests

```typescript
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ItemCard } from "./ItemCard";

describe("ItemCard", () => {
  test("renders item name", () => {
    const item = { id: "1", name: "Test Item" };
    render(<ItemCard item={item} />);
    expect(screen.getByText("Test Item")).toBeInTheDocument();
  });
});
```

### E2E Tests with Playwright

```typescript
import { test, expect } from "@playwright/test";

test("create item", async ({ page }) => {
  await page.goto("/items");
  await page.click("text=Create Item");
  await page.fill("#name", "New Item");
  await page.click("text=Save");
  await expect(page.locator("text=New Item")).toBeVisible();
});
```

## Troubleshooting

### API Not Found

Check that:
1. API is registered in plugin `apis` array
2. API ref is created with `createApiRef`
3. Factory function uses `rpcApi.forPlugin<T>()` with correct plugin ID
4. Plugin ID matches backend router registration name

### Type Errors with Contract

If TypeScript complains about contract types:
1. Ensure you're importing from the `-common` package
2. Verify the contract is exported from `src/index.ts` using named exports
3. Clear TypeScript cache: `rm -rf tsconfig.tsbuildinfo`
4. Restart the TypeScript language server

### Routes Not Working

Check that:
1. Routes are registered in plugin `routes` array
2. Path starts with `/`
3. Element is a valid React component

### Permission Errors

Check that:
1. Permission ID matches backend permission
2. User has required role/permission
3. Permission check is not in loading state

### 404 Errors from Backend

If RPC calls return 404:
1. Verify backend router is registered with correct plugin ID
2. Ensure frontend `forPlugin()` uses matching plugin ID
3. Check backend plugin is loaded (check backend logs)

## Migrating from Legacy REST Clients

If you have legacy clients using manual `fetch()` calls:

### Before (Legacy Pattern)

```typescript
export class MyPluginClient implements MyPluginApi {
  constructor(private fetchApi: FetchApi) {}

  async getItems(): Promise<Item[]> {
    return this.fetchApi.fetch("/api/myplugin-backend/items");
  }

  async createItem(data: CreateItem): Promise<Item> {
    return this.fetchApi.fetch("/api/myplugin-backend/items", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
```

### After (oRPC Pattern)

```typescript
// src/api.ts
import type { ContractRouterClient } from "@orpc/contract";
import { myPluginContract } from "@checkmate/myplugin-common";

export type MyPluginApi = ContractRouterClient<typeof myPluginContract>;
export const myPluginApiRef = createApiRef<MyPluginApi>("myplugin-api");

// src/index.tsx
apis: [
  {
    ref: myPluginApiRef,
    factory: (deps) => {
      const rpcApi = deps.get(rpcApiRef);
      return rpcApi.forPlugin<MyPluginApi>("myplugin-backend");
    },
  },
]
```

**Benefits:**
- No manual client class needed
- No hardcoded URLs
- Automatic type inference
- Compile-time contract validation

## Next Steps

- [Backend Plugin Development](./backend-plugins.md)
- [Common Plugin Guidelines](./common-plugins.md)
- [Extension Points](./extension-points.md)
- [UI Component Library](../packages/ui/README.md)
