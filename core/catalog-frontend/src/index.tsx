import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import {
  catalogRoutes,
  pluginMetadata,
  catalogAccess,
} from "@checkstack/catalog-common";

import { CatalogPage } from "./components/CatalogPage";
import { CatalogConfigPage } from "./components/CatalogConfigPage";
import { CatalogUserMenuItems } from "./components/UserMenuItems";
import { SystemDetailPage } from "./components/SystemDetailPage";

export const catalogPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  routes: [
    {
      route: catalogRoutes.routes.home,
      element: <CatalogPage />,
    },
    {
      route: catalogRoutes.routes.config,
      element: <CatalogConfigPage />,
      accessRule: catalogAccess.system.manage,
    },
    {
      route: catalogRoutes.routes.systemDetail,
      element: <SystemDetailPage />,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "catalog.user-menu.items",
      component: CatalogUserMenuItems,
    }),
  ],
});

export * from "./api";
