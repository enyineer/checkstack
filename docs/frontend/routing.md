# Frontend Routing

This guide covers the routing system for frontend plugins in Checkmate.

## Route Definition Pattern

Routes are defined in **common packages** using `createRoutes`, which establishes a contract between the common package (which defines the routes) and the frontend plugin (which provides the components).

### Defining Routes (Common Package)

```typescript
// In your-plugin-common/src/routes.ts
import { createRoutes } from "@checkmate/common";

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

Import the routes and use them with the `route` field:

```tsx
// In your-plugin-frontend/src/index.tsx
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { yourPluginRoutes, pluginMetadata } from "@checkmate/your-plugin-common";
import { HomePage } from "./pages/HomePage";
import { ConfigPage } from "./pages/ConfigPage";
import { DetailPage } from "./pages/DetailPage";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: yourPluginRoutes.routes.home,
      element: <HomePage />,
    },
    {
      route: yourPluginRoutes.routes.config,
      element: <ConfigPage />,
      permission: "your-plugin.manage",
    },
    {
      route: yourPluginRoutes.routes.detail,
      element: <DetailPage />,
    },
  ],
});
```

## Route Resolution

Routes can be resolved using `resolveRoute` from `@checkmate/common`:

### In Components
```tsx
import { resolveRoute } from "@checkmate/common";
import { catalogRoutes } from "@checkmate/catalog-common";

// Simple route
const configPath = resolveRoute(catalogRoutes.routes.config);
// Returns: "/catalog/config"

// With parameters
const detailPath = resolveRoute(catalogRoutes.routes.systemDetail, { systemId: "abc-123" });
// Returns: "/catalog/system/abc-123"
```

### Using the Hook
```tsx
import { usePluginRoute } from "@checkmate/frontend-api";
import { maintenanceRoutes } from "@checkmate/maintenance-common";

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

```
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
