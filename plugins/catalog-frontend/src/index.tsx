import { fetchApiRef, ApiRef } from "@checkmate/frontend-api";
import { CatalogClient } from "./client";
import { catalogApiRef } from "./api";
import { FrontendPlugin } from "@checkmate/frontend-api";

import { CatalogPage } from "./components/CatalogPage";
import { CatalogConfigPage } from "./components/CatalogConfigPage";
import { CatalogUserMenuItems } from "./components/UserMenuItems";

export const catalogPlugin: FrontendPlugin = {
  name: "catalog-frontend",
  apis: [
    {
      ref: catalogApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => {
        const fetchApi = deps.get(fetchApiRef);
        return new CatalogClient(fetchApi);
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
  ],
  extensions: [
    {
      id: "catalog.user-menu.items",
      slotId: "core.layout.navbar.user-menu.items",
      component: CatalogUserMenuItems,
    },
  ],
};

export * from "./api";
export * from "./client";
