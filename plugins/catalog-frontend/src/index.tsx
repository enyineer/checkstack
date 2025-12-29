import { rpcApiRef, ApiRef } from "@checkmate/frontend-api";
import { SLOT_USER_MENU_ITEMS } from "@checkmate/common";
import { catalogApiRef, type CatalogApi } from "./api";
import { createFrontendPlugin } from "@checkmate/frontend-api";

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
      path: "/catalog",
      element: <CatalogPage />,
    },
    {
      path: "/catalog/config",
      element: <CatalogConfigPage />,
      permission: "catalog.manage",
    },
    {
      path: "/system/:systemId",
      element: <SystemDetailPage />,
    },
  ],
  extensions: [
    {
      id: "catalog.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: CatalogUserMenuItems,
    },
  ],
});

export * from "./api";
