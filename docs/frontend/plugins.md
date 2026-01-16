---
---
# Frontend Plugin Development Guide

## Overview

Frontend plugins provide UI components, pages, routing, and client-side services. They are built using **React**, **React Router**, **ShadCN UI**, and **Vite**.

Frontend plugins consume **oRPC contracts** defined in `-common` packages, enabling type-safe RPC communication with the backend.

## Quick Start

### 1. Scaffold Plugin with CLI

The fastest way to create a frontend plugin is using the CLI:

```bash
bun run create
```

**Interactive prompts:**
1. Select `frontend` as the plugin type
2. Enter your plugin name (e.g., `myfeature`)
3. Provide a description (optional)
4. Confirm to generate

This will create a complete plugin structure with:
- ✅ Package configuration with React, router, and UI dependencies
- ✅ TypeScript configuration
- ✅ Contract-based API definition with typed client imports
- ✅ Example list page component with CRUD operations
- ✅ Plugin registration with routes and navigation
- ✅ Initial changeset for version management

**Generated structure:**
```
plugins/myfeature-frontend/
├── .changeset/
│   └── initial.md              # Version changeset
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── README.md                   # Documentation
└── src/
    ├── index.tsx               # Plugin entry point
    ├── api.ts                  # Contract-derived API types
    └── components/
        └── MyFeatureListPage.tsx  # Example page
```

### 2. Install Dependencies

```bash
cd plugins/myfeature-frontend
bun install
```

### 3. Customize Your Plugin

The generated plugin is a working example. Customize it for your domain:

#### Update API Types

**src/api.ts:**

The API types are imported from your common package (no derivation needed):

```typescript
import { createApiRef } from "@checkstack/frontend-api";
import { MyFeatureClient } from "@checkstack/myfeature-common";

// Re-export types for convenience
export type {
  MyItem,
  CreateMyItem,
  UpdateMyItem,
} from "@checkstack/myfeature-common";

// Use the client type from the common package
export type MyFeatureApi = MyFeatureClient;

export const myFeatureApiRef = createApiRef<MyFeatureApi>("myfeature-api");
```

#### Create Your Components

**src/components/MyFeaturePage.tsx:**

```typescript
import { useEffect, useState } from "react";
import { useApi } from "@checkstack/frontend-api";
import { myFeatureApiRef, type MyItem } from "../api";
import { Button, Card } from "@checkstack/ui";

export const MyFeaturePage = () => {
  const api = useApi(myFeatureApiRef);
  const [items, setItems] = useState<MyItem[]>([]);

  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Features</h1>
      <div className="grid gap-4">
        {items.map((item) => (
          <Card key={item.id} className="p-4">
            <h3>{item.name}</h3>
          </Card>
        ))}
      </div>
    </div>
  );
};
```

#### Register Routes

**src/index.tsx:**

```typescript
import { createFrontendPlugin } from "@checkstack/frontend-api";
import { MyFeaturePage } from "./components/MyFeaturePage";
import { myFeatureRoutes, pluginMetadata } from "@checkstack/myfeature-common";

export default createFrontendPlugin({
  metadata: pluginMetadata,

  // Register routes using typed route definitions
  routes: [
    {
      route: myFeatureRoutes.routes.home,
      element: <MyFeaturePage />,
    },
  ],
});
```

### 4. Verify

```bash
# Type check
bun run typecheck

# Lint
bun run lint
```

That's it! Your frontend plugin is ready to use.

> **Note:** Make sure you have also created the corresponding `-common` and `-backend` packages. See [Common Plugin Guidelines](../common/plugins.md) and [Backend Plugin Development](../backend/plugins.md) for details.

## Plugin Configuration

### `createFrontendPlugin(config)`

Creates a frontend plugin with the specified configuration.

**Parameters:**

#### `metadata` (required)

Plugin metadata from the common package (contains pluginId).

```typescript
import { pluginMetadata } from "@checkstack/myplugin-common";

metadata: pluginMetadata
```

#### `routes` (optional)

Register pages and their routes using RouteDefinitions from the common package.

```typescript
import { myRoutes } from "@checkstack/myplugin-common";

routes: [
  {
    route: myRoutes.routes.home,
    element: <ItemListPage />,
    title: "Items", // Optional: page title
    accessRule: access.itemRead.id, // Optional: required access rule
  },
]
```

#### `extensions` (optional)

Register components to inject into extension slots.

```typescript
import { UserMenuItemsSlot } from "@checkstack/frontend-api";

extensions: [
  {
    id: "myplugin.user-menu.items",
    slot: UserMenuItemsSlot,
    component: MyUserMenuItems,
  },
]
```

## Using Plugin APIs in Components

Components access plugin APIs using the `usePluginClient` hook with TanStack Query integration.

### Basic Usage

```typescript
import { usePluginClient } from "@checkstack/frontend-api";
import { MyPluginApi } from "@checkstack/myplugin-common";

export const ItemListPage = () => {
  const client = usePluginClient(MyPluginApi);

  // Queries - automatic caching, loading states, deduplication
  const { data: items, isLoading, error } = client.getItems.useQuery({});

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {items?.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
};
```

### Mutations with Cache Invalidation

```typescript
import { useQueryClient } from "@tanstack/react-query";

export const CreateItemForm = () => {
  const client = usePluginClient(MyPluginApi);
  const queryClient = useQueryClient();

  const createMutation = client.createItem.useMutation({
    onSuccess: () => {
      // Invalidate cache to refetch list
      queryClient.invalidateQueries({ queryKey: ["myplugin"] });
    },
  });

  const handleSubmit = (data: CreateItem) => {
    createMutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Button disabled={createMutation.isPending}>
        {createMutation.isPending ? "Creating..." : "Create"}
      </Button>
    </form>
  );
};
```

### Benefits

1. **No Manual State Management**: TanStack Query handles loading, error, and data states
2. **Automatic Request Deduplication**: Multiple components using the same query share one request
3. **Built-in Caching**: Configurable stale time and cache duration
4. **Background Refetching**: Stale data is automatically refreshed
5. **Type Safety**: Full TypeScript inference from contract definitions
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

### `usePluginClient`

Access plugin APIs with TanStack Query integration for automatic caching, loading states, and request deduplication:

```typescript
import { usePluginClient } from "@checkstack/frontend-api";
import { MyPluginApi } from "@checkstack/myplugin-common";

const client = usePluginClient(MyPluginApi);

// Queries - automatic caching and loading states
const { data, isLoading } = client.getItems.useQuery({});

// Mutations - with cache invalidation
const mutation = client.createItem.useMutation({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
});
```

> **Note:** Contracts must include `operationType: "query"` or `operationType: "mutation"` in their metadata.

#### Mutation Dependency Hazard

> [!CAUTION]
> **Never put mutation objects in dependency arrays.** `useMutation()` returns a new object on every render, which causes infinite re-renders if used in `useEffect`, `useMemo`, or `useCallback` dependencies.

```typescript
// ❌ BAD - causes infinite loop
const mutation = client.createItem.useMutation();
const callback = useMemo(() => {...}, [mutation]); // mutation changes every render!

// ✅ GOOD - mutation is stable when accessed inside the callback, not as a dependency
const mutation = client.createItem.useMutation();
const callback = useMemo(() => {
  return () => mutation.mutate(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [/* other stable deps */]);
```

The ESLint rule `checkstack/no-mutation-in-deps` catches this pattern.

### `accessApiRef`

Check user access rules.

```typescript
const accessApi = useApi(accessApiRef);

const canManage = accessApi.useAccess(access.itemManage.id);

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

## Access Gating

### Route-Level Access

```typescript
import { access } from "@checkstack/myplugin-common";

routes: [
  {
    path: "/config",
    element: <ItemConfigPage />,
    accessRule: access.itemManage.id,
  },
]
```

Users without access will see an "Access Denied" page.

### Component-Level Access

```typescript
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { access } from "@checkstack/myplugin-common";

export const ItemListPage = () => {
  const accessApi = useApi(accessApiRef);
  const canCreate = accessApi.useAccess(access.itemCreate.id);

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

### Access Loading State

```typescript
const accessState = accessApi.useAccess(access.itemManage.id);

if (accessState.loading) {
  return <LoadingSpinner />;
}

if (!accessState.allowed) {
  return <AccessDenied />;
}

return <ItemConfigPage />;
```

## UI Components

Use components from `@checkstack/ui` for consistent styling:

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
} from "@checkstack/ui";

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

Core slots are available from `@checkstack/frontend-api`:

```typescript
import {
  DashboardSlot,
  UserMenuItemsSlot,
  UserMenuItemsBottomSlot,
  NavbarRightSlot,
  NavbarLeftSlot,
} from "@checkstack/frontend-api";
```

### Injecting into Slots

Use the `slot:` property with a `SlotDefinition` object:

```typescript
import { UserMenuItemsSlot } from "@checkstack/frontend-api";

extensions: [
  {
    id: "myplugin.user-menu.items",
    slot: UserMenuItemsSlot,
    component: MyUserMenuItems,
  },
]
```

### Example: User Menu Items

```typescript
import { DropdownMenuItem } from "@checkstack/ui";
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
import { useApi } from "@checkstack/frontend-api";
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

### Server State with TanStack Query (Recommended)

The preferred approach is using `usePluginClient` with TanStack Query integration. This provides automatic caching, deduplication, loading states, and background refetching.

```typescript
import { usePluginClient } from "@checkstack/frontend-api";
import { MyPluginApi } from "@checkstack/myplugin-common";

export const ItemListPage = () => {
  const client = usePluginClient(MyPluginApi);

  // Queries - automatic loading/error states
  const { data: items, isLoading, error } = client.getItems.useQuery({});

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return <ItemList items={items ?? []} />;
};
```

#### useQuery for Data Fetching

```typescript
// Query with no parameters
const { data, isLoading } = client.getItems.useQuery();

// Query with parameters
const { data: item } = client.getItem.useQuery({ id: itemId });

// Query with options (disable until ready)
const { data } = client.getItems.useQuery({ filter }, {
  enabled: !!filter,
  staleTime: 60_000, // Cache for 1 minute
});
```

#### useMutation for Data Modifications

```typescript
export const ItemForm = () => {
  const client = usePluginClient(MyPluginApi);
  const queryClient = useQueryClient();

  const createMutation = client.createItem.useMutation({
    onSuccess: () => {
      // Invalidate cache to refetch list
      queryClient.invalidateQueries({ queryKey: ['items'] });
      toast.success("Item created!");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (data: CreateItem) => {
    createMutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Button disabled={createMutation.isPending}>
        {createMutation.isPending ? "Creating..." : "Create"}
      </Button>
    </form>
  );
};
```

> **Note:** Contracts must include `operationType: "query"` or `operationType: "mutation"` in their metadata. Queries expose `.useQuery()`, mutations expose `.useMutation()`.

## Forms

### Basic Form

```typescript
import { useState } from "react";
import { Button, Input, Label } from "@checkstack/ui";

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
import { useApi } from "@checkstack/frontend-api";
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
import type { Item, CreateItem } from "@checkstack/myplugin-common";

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
1. The Api definition is exported from the `-common` package
2. Contract's `pluginId` matches backend router registration name
3. Backend for this plugin is running

### Type Errors with Contract

If TypeScript complains about contract types:
1. Ensure you're importing from the `-common` package
2. Verify the `*Api` definition and contract are exported from `src/index.ts`
3. Clear TypeScript cache: `rm -rf tsconfig.tsbuildinfo`
4. Restart the TypeScript language server

### Routes Not Working

Check that:
1. Routes are registered in plugin `routes` array
2. Route definitions use `route:` with RouteDefinition from common
3. Element is a valid React component

### Access Errors

Check that:
1. Access rule ID matches backend access rule
2. User has required role/access
3. Access check is not in loading state

### 404 Errors from Backend

If RPC calls return 404:
1. Verify backend router is registered with correct plugin ID
2. Ensure frontend uses the correct Api definition that matches backend pluginId
3. Check backend plugin is loaded (check backend logs)

## Dynamic Plugin Loading

Frontend plugins can be loaded and unloaded at runtime without a page refresh. When a frontend plugin is installed or uninstalled on the backend, the platform broadcasts a signal to all connected frontends, triggering automatic UI updates.

### Architecture

```mermaid
sequenceDiagram
    participant Admin as Admin UI
    participant Backend as Backend
    participant Signal as Signal Service
    participant Frontend as Frontend
    participant Registry as Plugin Registry

    Admin->>Backend: Install plugin
    Backend->>Backend: Load plugin
    Backend->>Signal: Broadcast PLUGIN_INSTALLED
    Signal->>Frontend: WebSocket signal
    Frontend->>Frontend: loadSinglePlugin()
    Frontend->>Registry: register(plugin)
    Registry->>Frontend: Re-render UI
```

### How It Works

1. **Signal Emission**: The backend emits `PLUGIN_INSTALLED` or `PLUGIN_DEREGISTERED` signals only for frontend plugins (those ending with `-frontend`)

2. **Frontend Signal Subscription**: The `usePluginLifecycle` hook listens for these signals:
   ```typescript
   // Automatically handled in App.tsx via usePluginLifecycle()
   useSignal(PLUGIN_INSTALLED, ({ pluginId }) => {
     loadSinglePlugin(pluginId);  // Dynamically loads JS/CSS
   });

   useSignal(PLUGIN_DEREGISTERED, ({ pluginId }) => {
     unloadPlugin(pluginId);  // Removes from registry
   });
   ```

3. **Registry Updates**: When a plugin is loaded/unloaded, the `pluginRegistry` increments its version, triggering React re-renders to pick up new routes and extensions.

### Plugin Registry Reactivity

The `pluginRegistry` supports dynamic updates:

```typescript
// Subscribe to registry changes
pluginRegistry.subscribe(() => {
  console.log("Registry changed, re-render!");
});

// Check if a plugin is registered
if (pluginRegistry.hasPlugin("my-plugin-frontend")) {
  // Plugin is available
}

// Get current version (increments on every change)
const version = pluginRegistry.getVersion();
```

### Signals Used

| Signal | Payload | Description |
|--------|---------|-------------|
| `PLUGIN_INSTALLED` | `{ pluginId: string }` | Frontend plugin was installed |
| `PLUGIN_DEREGISTERED` | `{ pluginId: string }` | Frontend plugin was removed |

> **Note**: Only plugins ending with `-frontend` trigger signals. Backend-only plugins are not signaled to the frontend.

## Next Steps

- [Backend Plugin Development](../backend/plugins.md)
- [Common Plugin Guidelines](../common/plugins.md)
- [Extension Points](./extension-points.md)
- [UI Component Library](../core/ui/README.md)

