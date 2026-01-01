import { rpcApiRef, ApiRef, UserMenuItemsSlot } from "@checkmate/frontend-api";
import { catalogApiRef, type CatalogApi } from "./api";
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { catalogRoutes } from "@checkmate/catalog-common";

import { CatalogPage } from "./components/CatalogPage";
import { CatalogConfigPage } from "./components/CatalogConfigPage";
import { CatalogUserMenuItems } from "./components/UserMenuItems";
import { SystemDetailPage } from "./components/SystemDetailPage";

export const catalogPlugin = createFrontendPlugin({
  name: "catalog-frontend",
  apis: [
    {
      ref: catalogApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): CatalogApi => {
        const rpcApi = deps.get(rpcApiRef);
        // CatalogApi is derived from the contract type
        return rpcApi.forPlugin<CatalogApi>("catalog-backend");
      },
    },
  ],
  routes: [
    {
      route: catalogRoutes.routes.home,
      element: <CatalogPage />,
    },
    {
      route: catalogRoutes.routes.config,
      element: <CatalogConfigPage />,
      permission: "catalog.manage",
    },
    {
      route: catalogRoutes.routes.systemDetail,
      element: <SystemDetailPage />,
    },
  ],
  extensions: [
    {
      id: "catalog.user-menu.items",
      slot: UserMenuItemsSlot,
      component: CatalogUserMenuItems,
    },
  ],
});

export * from "./api";
