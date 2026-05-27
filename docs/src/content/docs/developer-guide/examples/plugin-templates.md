---
title: "Plugin Templates"
description: "Starter snippets for plugin routers, contract bindings, and oRPC handlers."
---
## Minimal Contract-Based Router

```typescript
// plugins/my-feature-backend/src/router.ts
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import { myFeatureContract } from "@checkstack/my-feature-common";

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
import type { ProcedureMetadata } from "@checkstack/common";
import { z } from "zod";
import { myFeatureAccess } from "./access";

const _base = oc.$meta<ProcedureMetadata>({});

export const myFeatureContract = {
  getItems: _base
    .meta({ userType: "user", access: [myFeatureAccess.myfeatureRead] })
    .output(z.array(ItemSchema)),

  createItem: _base
    .meta({ userType: "user", access: [myFeatureAccess.myfeatureManage] })
    .input(CreateItemSchema)
    .output(ItemSchema),
};
```

---

## Minimal Access Rules

```typescript
// plugins/my-feature-common/src/access.ts
import { accessPair } from "@checkstack/common";

/**
 * Access rules for my-feature plugin.
 * Uses accessPair() to create read/manage pairs.
 */
export const myFeatureAccess = {
  ...accessPair("myfeature", {
    readDescription: "View items",
    manageDescription: "Create, update, delete items",
    isDefault: true, // read is auto-assigned to "users" role
  }),
};

export const myFeatureAccessRules = Object.values(myFeatureAccess);
```

---

## Minimal Routes

```typescript
// plugins/my-feature-common/src/routes.ts
import { createRoutes } from "@checkstack/common";

export const myFeatureRoutes = createRoutes("my-feature", {
  home: "/",
});
```

---

## Minimal Frontend Plugin

```typescript
// plugins/my-feature-frontend/src/index.tsx
import { createFrontendPlugin, rpcApiRef, type ApiRef } from "@checkstack/frontend-api";
import { myFeatureApiRef, type MyFeatureApiClient } from "./api";
import { ItemsPage } from "./components/ItemsPage";
import { myFeatureRoutes, MyFeatureApi, pluginMetadata, myFeatureAccess } from "@checkstack/my-feature-common";

export default createFrontendPlugin({
  metadata: pluginMetadata,

  routes: [
    {
      route: myFeatureRoutes.routes.home,
      element: <ItemsPage />,
      title: "Items",
      accessRule: myFeatureAccess.myfeatureRead,
    },
  ],

  apis: [
    {
      ref: myFeatureApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): MyFeatureApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin(MyFeatureApi);
      },
    },
  ],
});
```

---

## See Also

- [Backend Plugin Guide](/checkstack/developer-guide/backend/plugins/)
- [Frontend Plugin Guide](/checkstack/developer-guide/frontend/plugins/)
- [Common Plugin Guide](/checkstack/developer-guide/common/plugins/)
- [CLI Scaffolding](/checkstack/developer-guide/tooling/cli/)
- [Drizzle Schema Isolation](/checkstack/developer-guide/backend/drizzle-schema/)
