import {
  rpcApiRef,
  ApiRef,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import { catalogApiRef, type CatalogApiClient } from "./api";
import { createFrontendPlugin } from "@checkmate-monitor/frontend-api";
import {
  catalogRoutes,
  CatalogApi,
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/catalog-common";

import { CatalogPage } from "./components/CatalogPage";
import { CatalogConfigPage } from "./components/CatalogConfigPage";
import { CatalogUserMenuItems } from "./components/UserMenuItems";
import { SystemDetailPage } from "./components/SystemDetailPage";

export const catalogPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [
    {
      ref: catalogApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): CatalogApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        // CatalogApiClient is derived from the contract type
        return rpcApi.forPlugin(CatalogApi);
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
      permission: permissions.catalogManage,
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
