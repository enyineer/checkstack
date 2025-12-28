# Frontend Plugin Development Guide

## Overview

Frontend plugins provide UI components, pages, routing, and client-side services. They are built using **React**, **React Router**, **ShadCN UI**, and **Vite**.

## Quick Start

### 1. Create Plugin Structure

```bash
mkdir -p plugins/myplugin-frontend/src
cd plugins/myplugin-frontend
```

### 2. Initialize Packages

Create `package.json` for each package. Then run the sync tool to apply shared configurations:

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

### 3. Create Plugin Entry Point

**src/index.tsx:**

```typescript
import { createFrontendPlugin, fetchApiRef } from "@checkmate/frontend-api";
import { MyPluginClient } from "./client";
import { myPluginApiRef } from "./api";
import { ItemListPage } from "./components/ItemListPage";
import { ItemDetailPage } from "./components/ItemDetailPage";
import { permissions } from "@checkmate/myplugin-common";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  
  // Register client API
  apis: [
    {
      ref: myPluginApiRef,
      factory: (deps) => {
        const fetchApi = deps.get(fetchApiRef);
        return new MyPluginClient(fetchApi);
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
  
  // Register UI extensions
  extensions: [
    {
      id: "myplugin.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: MyUserMenuItems,
    },
  ],
});

export * from "./api";
export * from "./client";
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
      const fetchApi = deps.get(fetchApiRef);
      return new MyPluginClient(fetchApi);
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
    permission: "item.read", // Optional: required permission
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

## Client API Pattern

### Define API Interface

**src/api.ts:**

```typescript
import { createApiRef } from "@checkmate/frontend-api";

export interface Item {
  id: string;
  name: string;
  description?: string;
}

export interface MyPluginApi {
  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item>;
  createItem(data: Omit<Item, "id">): Promise<Item>;
  updateItem(id: string, data: Partial<Item>): Promise<Item>;
  deleteItem(id: string): Promise<void>;
}

export const myPluginApiRef = createApiRef<MyPluginApi>("my-plugin-api");
```

### Implement Client

**src/client.ts:**

```typescript
import { FetchApi } from "@checkmate/frontend-api";
import { MyPluginApi, Item } from "./api";

export class MyPluginClient implements MyPluginApi {
  constructor(private fetchApi: FetchApi) {}

  async getItems(): Promise<Item[]> {
    return this.fetchApi.fetch("/api/myplugin-backend/items");
  }

  async getItem(id: string): Promise<Item> {
    return this.fetchApi.fetch(`/api/myplugin-backend/items/${id}`);
  }

  async createItem(data: Omit<Item, "id">): Promise<Item> {
    return this.fetchApi.fetch("/api/myplugin-backend/items", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateItem(id: string, data: Partial<Item>): Promise<Item> {
    return this.fetchApi.fetch(`/api/myplugin-backend/items/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteItem(id: string): Promise<void> {
    await this.fetchApi.fetch(`/api/myplugin-backend/items/${id}`, {
      method: "DELETE",
    });
  }
}
```

### Use in Components

```typescript
import { useApi } from "@checkmate/frontend-api";
import { myPluginApiRef } from "../api";

export const ItemListPage = () => {
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
};
```

## Core APIs

The core provides these APIs for use in components:

### `fetchApiRef`

HTTP client with automatic authentication.

```typescript
const fetchApi = useApi(fetchApiRef);

const data = await fetchApi.fetch("/api/myplugin-backend/items");
```

### `permissionApiRef`

Check user permissions.

```typescript
const permissionApi = useApi(permissionApiRef);

const canManage = permissionApi.usePermission("item.manage");

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

### Server State

```typescript
import { useEffect, useState } from "react";
import { useApi } from "@checkmate/frontend-api";

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

### List Page

```typescript
export const ItemListPage = () => {
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

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

  const handleSubmit = async (data: ItemData) => {
    if (id) {
      await api.updateItem(id, data);
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
3. Factory function returns correct implementation

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

## Next Steps

- [Backend Plugin Development](./backend-plugins.md)
- [Common Plugin Guidelines](./common-plugins.md)
- [Extension Points](./extension-points.md)
- [UI Component Library](../packages/ui/README.md)
