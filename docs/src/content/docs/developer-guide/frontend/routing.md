---
title: "Frontend Routing"
description: "This guide covers the routing system for frontend plugins in Checkstack."
---

This guide covers the routing system for frontend plugins in Checkstack.

## Route Definition Pattern

Routes are defined in **common packages** using `createRoutes`, which establishes a contract between the common package (which defines the routes) and the frontend plugin (which provides the components).

### Defining Routes (Common Package)

```typescript
// In your-plugin-common/src/routes.ts
import { createRoutes } from "@checkstack/common";

export const yourPluginRoutes = createRoutes("your-plugin", {
  home: "/",
  config: "/config",
  detail: "/detail/:id",  // Path parameters are supported
});
```

Export from your index:
```typescript
// In your-plugin-common/src/index.ts
export { yourPluginRoutes } from "./routes";
```

### Using Routes (Frontend Plugin)

Each route declares a `load` thunk that imports its page module. The framework
code-splits the page and wraps it in a Suspense boundary plus a per-plugin error
boundary, so the page's JavaScript is fetched on navigation (never in the
initial app load) and a page that fails to load degrades gracefully instead of
crashing the shell. Plugins do NOT call `React.lazy` themselves.

```tsx
// In your-plugin-frontend/src/index.tsx
import { createFrontendPlugin } from "@checkstack/frontend-api";
import { yourPluginRoutes, pluginMetadata, yourPluginAccess } from "@checkstack/your-plugin-common";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: yourPluginRoutes.routes.home,
      // `load` returns the page module. For a named export, map it to `default`:
      load: () => import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
    },
    {
      route: yourPluginRoutes.routes.config,
      load: () => import("./pages/ConfigPage").then((m) => ({ default: m.ConfigPage })),
      accessRule: yourPluginAccess.manage,
    },
    {
      route: yourPluginRoutes.routes.detail,
      load: () => import("./pages/DetailPage").then((m) => ({ default: m.DetailPage })),
    },
  ],
});
```

> [!NOTE]
> A route may instead provide an eager `element: <Page />` (mutually exclusive
> with `load`). Reserve this for the rare page that must paint without a chunk
> fetch - e.g. the login page on the unauthenticated critical path. Everything
> else should use `load`.

## Sidebar navigation

The left sidebar is the app's primary navigation. A route opts into it by adding
`nav` metadata - there is no separate nav registry, and the user menu is
account-only (profile, theme, logout). Routes without `nav` are still reachable
(deep links, detail pages) but are not listed in the sidebar.

```tsx
import { Activity } from "lucide-react";

{
  route: yourPluginRoutes.routes.config,
  load: () => import("./pages/ConfigPage").then((m) => ({ default: m.ConfigPage })),
  title: "Health Checks",
  accessRule: yourPluginAccess.configuration.manage,
  nav: {
    group: "Reliability",          // section heading (see canonical groups below)
    icon: Activity,                // any lucide-react icon (or ComponentType<{className?}>)
    // label defaults to the route `title`; set to override.
    // order defaults to 0 (lower sorts first within the group).
    // accessRule defaults to the route's accessRule; override to show the entry
    // on a BROADER rule than the page needs (e.g. nav on `read`, page on `manage`).
    accessRule: yourPluginAccess.configuration.read,
  },
},
```

The sidebar filters entries by the user's access rules (via the same check as
page guards, so nav visibility matches page accessibility), groups them, and
highlights the active route. A group whose every entry is filtered out is not
rendered. Canonical group order: **Workspace**, **Reliability**, **Automation**,
**Configuration**, **Documentation**; unknown groups are appended alphabetically.

For entries whose visibility cannot be expressed as one static `accessRule`, add
a dynamic `nav.isVisible` predicate. It receives the user's `accessRules` (rule
ids) and `isAuthenticated`, and is evaluated IN ADDITION to `accessRule` (both
must pass). Use it when visibility depends on runtime contributions or on auth
state rather than a single rule:

```ts
nav: {
  group: "Configuration",
  icon: Server,
  // Show only when the user can read at least one tab contributed by other
  // plugins (the Infrastructure page aggregates them via a slot):
  isVisible: ({ accessRules }) =>
    pluginRegistry
      .getExtensions(InfrastructureTabsSlot.id)
      .some((ext) => isAccessRuleSatisfied(accessRules, ext.metadata.readAccess)),
  // Or, for a per-user page that needs a login but no specific rule:
  // isVisible: ({ isAuthenticated }) => isAuthenticated,
},
```

For gating buttons/links INSIDE a page on auth state (not a specific rule), use
`accessApi.useIsAuthenticated()` (alongside `accessApi.useAccess(rule)`).

> [!NOTE]
> `nav.icon` is a component (`React.ComponentType<{ className?: string }>`), so
> lucide-react icons work directly. Keep it imported in the plugin's
> `index.tsx`, alongside the route registration.

## Route Resolution

Routes can be resolved using `resolveRoute` from `@checkstack/common`:

### In Components
```tsx
import { resolveRoute } from "@checkstack/common";
import { catalogRoutes } from "@checkstack/catalog-common";

// Simple route
const configPath = resolveRoute(catalogRoutes.routes.config);
// Returns: "/catalog/config"

// With parameters
const detailPath = resolveRoute(catalogRoutes.routes.systemDetail, { systemId: "abc-123" });
// Returns: "/catalog/system/abc-123"
```

### Using the Hook
```tsx
import { usePluginRoute } from "@checkstack/frontend-api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";

function MyComponent() {
  const getRoute = usePluginRoute();
  
  return (
    <Link to={getRoute(maintenanceRoutes.routes.config)}>
      Maintenances
    </Link>
  );
}
```

## Runtime Validation

The plugin registry automatically validates that route `pluginId` matches the frontend plugin name. For example, if a plugin named `maintenance-frontend` registers a route with `pluginId: "maintenence"` (typo), an error is thrown:

```text
❌ Route pluginId mismatch: route "maintenence.config" has pluginId "maintenence" 
but plugin is "maintenance-frontend" (base: "maintenance")
```

This ensures consistency between common package definitions and frontend plugins.

## Auto-Prefixing

All routes are automatically prefixed with `/{pluginId}`:

- Route path `/config` in plugin `maintenance` → `/maintenance/config`
- Route path `/` in plugin `catalog` → `/catalog/`
- Route path `/system/:systemId` in plugin `catalog` → `/catalog/system/:systemId`

## Best Practices

1. **Define routes in common packages** - This allows both frontend and backend to share route definitions.

2. **Use `resolveRoute` for links** - Instead of hardcoding paths, use `resolveRoute` to get the full path.

3. **Use path parameters** - Define dynamic segments with `:paramName` syntax for type-safe parameter substitution.

4. **Export routes from common index** - Make routes easily importable.
