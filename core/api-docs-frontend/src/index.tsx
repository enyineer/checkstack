import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import { pluginMetadata, apiDocsAccess } from "@checkstack/api-docs-common";
import { lazy } from "react";
import { ApiDocsMenuItem } from "./ApiDocsMenuItem";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const ApiDocsPage = lazy(() =>
  import("./ApiDocsPage").then((m) => ({ default: m.ApiDocsPage })),
);

export const apiDocsRoutes = createRoutes(pluginMetadata.pluginId, {
  docs: "/",
});

export const apiDocsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: apiDocsRoutes.routes.docs,
      element: <ApiDocsPage />,
      accessRule: apiDocsAccess.view,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "api-docs.user-menu.link",
      component: ApiDocsMenuItem,
      metadata: { group: "Documentation" },
    }),
  ],
});

export default apiDocsPlugin;
