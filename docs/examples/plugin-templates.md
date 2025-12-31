---
---
# Plugin Templates

Minimal examples for creating Checkmate plugins. See full guides: [Backend](../backend/plugins.md), [Frontend](../frontend/plugins.md), [Common](../common/plugins.md).

## Minimal Backend Plugin

```typescript
// plugins/my-feature-backend/src/index.ts
import { createBackendPlugin, coreServices } from "@checkmate/backend-api";
import { permissions, myFeatureContract } from "@checkmate/my-feature-common";
import { createMyFeatureRouter } from "./router";
import * as schema from "./schema";

export default createBackendPlugin({
  pluginId: "my-feature-backend",
  register(env) {
    env.registerInit({
      deps: {
        database: coreServices.database,
        logger: coreServices.logger,
        permissionRegistry: coreServices.permissionRegistry,
      },
      init: async ({ database, logger, permissionRegistry }) => {
        // Register permissions
        Object.values(permissions).forEach((p) => permissionRegistry.register(p));
        
        // Register router
        env.registerRouter(createMyFeatureRouter({ database }));
        
        logger.debug("my-feature-backend initialized");
      },
    });
  },
});
```

---

## Minimal Contract-Based Router

```typescript
// plugins/my-feature-backend/src/router.ts
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkmate/backend-api";
import { myFeatureContract } from "@checkmate/my-feature-common";

const os = implement(myFeatureContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export function createMyFeatureRouter({ database }) {
  return os.router({
    getItems: os.getItems.handler(async () => {
      return await database.select().from(schema.items);
    }),
    
    createItem: os.createItem.handler(async ({ input }) => {
      const [item] = await database.insert(schema.items).values(input).returning();
      return item;
    }),
  });
}
```

---

## Minimal oRPC Contract

```typescript
// plugins/my-feature-common/src/rpc-contract.ts
import { oc } from "@orpc/contract";
import type { ProcedureMetadata } from "@checkmate/common";
import { z } from "zod";
import { permissions } from "./permissions";

const _base = oc.$meta<ProcedureMetadata>({});

export const myFeatureContract = {
  getItems: _base
    .meta({ userType: "user", permissions: [permissions.read.id] })
    .output(z.array(ItemSchema)),

  createItem: _base
    .meta({ userType: "user", permissions: [permissions.manage.id] })
    .input(CreateItemSchema)
    .output(ItemSchema),
};
```

---

## Minimal Permissions

```typescript
// plugins/my-feature-common/src/permissions.ts
import { createPermission } from "@checkmate/common";

export const permissions = {
  read: createPermission({
    id: "my-feature-backend.items.read",
    displayName: "Read Items",
    description: "View items",
    isDefault: true, // Granted to users role
  }),
  
  manage: createPermission({
    id: "my-feature-backend.items.manage",
    displayName: "Manage Items",
    description: "Create, update, delete items",
  }),
};
```

---

## Minimal Frontend Plugin

```typescript
// plugins/my-feature-frontend/src/index.tsx
import { createFrontendPlugin, pageApiRef, navApiRef } from "@checkmate/frontend-api";
import { myFeatureApiRef, createMyFeatureApi } from "./api";
import { ItemsPage } from "./components/ItemsPage";

export default createFrontendPlugin({
  pluginId: "my-feature-frontend",
  register(env) {
    // Register API
    env.registerApi(myFeatureApiRef, ({ authClient }) => createMyFeatureApi(authClient));
    
    // Register pages
    env.registerApi(pageApiRef, () => ({
      pages: [{
        path: "/items",
        element: <ItemsPage />,
        title: "Items",
      }],
    }));
    
    // Register navigation
    env.registerApi(navApiRef, () => ({
      items: [{
        path: "/items",
        label: "Items",
        icon: "📦",
      }],
    }));
  },
});
```

---

## See Also

- [Backend Plugin Guide](../backend/plugins.md)
- [Frontend Plugin Guide](../frontend/plugins.md)
- [Common Plugin Guide](../common/plugins.md)
- [CLI Scaffolding](../tooling/cli.md)
