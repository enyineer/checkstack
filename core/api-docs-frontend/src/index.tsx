import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import { createRoutes } from "@checkmate-monitor/common";
import {
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/api-docs-common";
import { ApiDocsPage } from "./ApiDocsPage";
import { ApiDocsMenuItem } from "./ApiDocsMenuItem";

export const apiDocsRoutes = createRoutes(pluginMetadata.pluginId, {
  docs: "/",
});

export const apiDocsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: apiDocsRoutes.routes.docs,
      element: <ApiDocsPage />,
      permission: permissions.apiDocsView,
    },
  ],
  extensions: [
    {
      id: "api-docs.user-menu.link",
      slot: UserMenuItemsSlot,
      component: ApiDocsMenuItem,
    },
  ],
});

export default apiDocsPlugin;
