import { fetchApiRef, ApiRef } from "@checkmate/frontend-api";
import { CatalogClient } from "./client";
import { catalogApiRef } from "./api";
import { FrontendPlugin } from "@checkmate/frontend-api";

import { CatalogPage } from "./components/CatalogPage";

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
      title: "Catalog",
      element: <CatalogPage />,
    },
  ],
  navItems: [
    {
      title: "Catalog",
      path: "/catalog",
    },
  ],
};

export * from "./api";
export * from "./client";
