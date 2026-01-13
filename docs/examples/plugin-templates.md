---
---
# Plugin Templates

Minimal examples for creating Checkstack plugins. See full guides: [Backend](../backend/plugins.md), [Frontend](../frontend/plugins.md), [Common](../common/plugins.md).

## Minimal Backend Plugin

### Plugin Metadata

```typescript
// plugins/my-feature-backend/src/plugin-metadata.ts
import { definePluginMetadata } from "@checkstack/common";

export const pluginMetadata = definePluginMetadata({
  pluginId: "my-feature",
});
```

### Main Plugin Entry

```typescript
// plugins/my-feature-backend/src/index.ts
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { myFeatureAccessRules } from "@checkstack/my-feature-common";
import { createMyFeatureRouter } from "./router";
import { pluginMetadata } from "./plugin-metadata";
import * as schema from "./schema";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(myFeatureAccessRules);

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc, logger }) => {
        logger.debug("my-feature initialized");
        const router = createMyFeatureRouter({ database });
        rpc.registerRouter(router);
      },
    });
  },
});
```

### Database Schema

```typescript
// plugins/my-feature-backend/src/schema.ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Item = typeof items.$inferSelect;
```

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

- [Backend Plugin Guide](../backend/plugins.md)
- [Frontend Plugin Guide](../frontend/plugins.md)
- [Common Plugin Guide](../common/plugins.md)
- [CLI Scaffolding](../tooling/cli.md)
- [Drizzle Schema Isolation](../backend/drizzle-schema.md)
