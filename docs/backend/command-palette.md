---
layout: default
title: Command Palette & Search
parent: Backend
---

# Command Palette & Search

The Command Palette provides a unified, keyboard-accessible interface for navigating the application and executing commands. Plugins can contribute both **commands** (actionable items with optional keyboard shortcuts) and **searchable entities** (like systems, incidents, etc.) to the palette.

## Overview

The command palette system consists of three packages:

| Package | Purpose |
|---------|---------|
| `@checkstack/command-backend` | Backend registry and search aggregation |
| `@checkstack/command-common` | Shared types and RPC contract |
| `@checkstack/command-frontend` | Frontend hooks for search and shortcuts |

## Registering Commands

Commands are actionable items that navigate users to specific routes. They can have keyboard shortcuts for quick access.

### Simple Command Registration

For most plugins, use the simplified `commands` API:

```typescript
import { registerSearchProvider } from "@checkstack/command-backend";
import { pluginMetadata, access } from "@checkstack/my-plugin-common";
import { resolveRoute } from "@checkstack/common";
import { myRoutes } from "./routes";

// In your plugin's init phase
registerSearchProvider({
  pluginMetadata,
  commands: [
    {
      id: "create",
      title: "Create Item",
      subtitle: "Create a new item",
      iconName: "Plus", // Lucide icon name
      shortcuts: ["meta+shift+n", "ctrl+shift+n"],
      route: resolveRoute(myRoutes.routes.config) + "?action=create",
      requiredAccessRules: [access.myAccess],
    },
    {
      id: "manage",
      title: "Manage Items",
      subtitle: "View and manage all items",
      iconName: "List",
      route: resolveRoute(myRoutes.routes.config),
      // No requiredAccessRules = visible to all users
    },
  ],
});
```

### CommandDefinition Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique ID (prefixed with plugin ID automatically) |
| `title` | `string` | ✅ | Display title in the palette |
| `subtitle` | `string` | ❌ | Secondary description text |
| `iconName` | `string` | ❌ | Lucide icon name (e.g., "AlertCircle", "Wrench") |
| `shortcuts` | `string[]` | ❌ | Keyboard shortcuts (e.g., `["meta+shift+i", "ctrl+shift+i"]`) |
| `route` | `string` | ✅ | Navigation route when command is executed |
| `requiredAccessRules` | `AccessRule[]` | ❌ | AccessRule objects (auto-qualified) |

### Keyboard Shortcuts

Shortcuts use a cross-platform format:
- `meta` = ⌘ on Mac, Windows key on Windows
- `ctrl` = Control key
- `shift` = Shift key
- `alt` = ⌥ on Mac, Alt on Windows

For cross-platform support, define both variants:
```typescript
shortcuts: ["meta+shift+i", "ctrl+shift+i"]
```

## Registering Searchable Entities

For searchable entities (like systems, incidents, etc.), use the `provider` option:

```typescript
import { registerSearchProvider } from "@checkstack/command-backend";
import { pluginMetadata } from "@checkstack/my-plugin-common";
import { resolveRoute } from "@checkstack/common";
import * as schema from "./schema";

registerSearchProvider({
  pluginMetadata,
  provider: {
    id: "items",
    name: "Items",
    priority: 100, // Higher = appears first (default: 0)
    search: async (query, { userAccessRules }) => {
      const db = getDatabase(); // Your database access
      const items = await db.select().from(schema.items);
      const q = query.toLowerCase();

      return items
        .filter(
          (item) =>
            !q ||
            item.name.toLowerCase().includes(q) ||
            item.description?.toLowerCase().includes(q)
        )
        .map((item) => ({
          id: item.id,
          type: "entity" as const,
          title: item.name,
          subtitle: item.description,
          category: "Items",
          iconName: "Box",
          route: resolveRoute(myRoutes.routes.detail, { itemId: item.id }),
          // Optional: requiredAccessRules for access filtering
        }));
    },
  },
});
```

### SearchResult Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier |
| `type` | `"entity" \| "command"` | ✅ | Result type |
| `title` | `string` | ✅ | Primary display text |
| `subtitle` | `string` | ❌ | Secondary text |
| `category` | `string` | ✅ | Grouping label (e.g., "Systems", "Incidents") |
| `iconName` | `string` | ❌ | Lucide icon name |
| `route` | `string` | ❌ | Navigation route |
| `shortcuts` | `string[]` | ❌ | Keyboard shortcuts (commands only) |
| `requiredAccessRules` | `string[]` | ❌ | Required access rule IDs |

## Access Handling

Access rules are **automatically qualified** with the plugin ID:

```typescript
// You provide:
requiredAccessRules: [access.myManage]
// which has id: "my.manage"

// Becomes fully qualified:
// "my-plugin.my.manage"
```

Users with the `"*"` (wildcard) access see all commands regardless of requirements.

## URL Action Parameters

To support deep-linking from commands (e.g., "Create Incident" → opens create dialog), handle URL parameters in your frontend:

```tsx
import { useSearchParams } from "react-router-dom";

function MyConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [editorOpen, setEditorOpen] = useState(false);

  // Handle ?action=create URL parameter
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // ...
}
```

## Complete Example: Incident Plugin

Here's how the incident plugin registers its commands:

```typescript
// incident-backend/src/index.ts
import { registerSearchProvider } from "@checkstack/command-backend";
import {
  pluginMetadata,
  access,
  incidentRoutes,
} from "@checkstack/incident-common";
import { resolveRoute } from "@checkstack/common";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: { /* ... */ },
      init: async ({ /* ... */ }) => {
        // ... other initialization ...

        // Register command palette entries
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Incident",
              subtitle: "Report a new incident affecting systems",
              iconName: "AlertCircle",
              shortcuts: ["meta+shift+i", "ctrl+shift+i"],
              route: resolveRoute(incidentRoutes.routes.config) + "?action=create",
              requiredAccessRules: [access.incidentManage],
            },
          ],
        });
      },
    });
  },
});
```

## Architecture Notes

### Backend Flow

1. Plugins call `registerSearchProvider()` during initialization
2. The command backend aggregates all providers
3. When a search query comes in:
   - All providers are queried in parallel
   - Results are flattened and sorted by priority
   - Results are filtered by user access rules
   - Filtered results are returned to the frontend

### Frontend Flow

1. `GlobalShortcuts` component fetches commands on mount
2. Global keyboard listeners are registered for all shortcuts
3. When the palette opens, `search("")` fetches all available items
4. As the user types, results are filtered by the query
5. Selecting a result navigates to the specified route

### Access Filtering

Results are filtered twice:
1. **Backend**: `filterByAccessRules()` removes results the user can't access
2. **Frontend**: Global shortcuts also check access before triggering

Users with the `"*"` wildcard access bypass all access checks.
