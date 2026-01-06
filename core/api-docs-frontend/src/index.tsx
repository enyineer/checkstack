import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkmate/frontend-api";
import { definePluginMetadata, createRoutes } from "@checkmate/common";
import { ApiDocsPage } from "./ApiDocsPage";
import { ApiDocsMenuItem } from "./ApiDocsMenuItem";
import { permissions as authPermissions } from "@checkmate/auth-common";

const pluginMetadata = definePluginMetadata({
  pluginId: "api-docs",
});

export const apiDocsRoutes = createRoutes(pluginMetadata.pluginId, {
  docs: "/api-docs",
});

export const apiDocsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: apiDocsRoutes.routes.docs,
      element: <ApiDocsPage />,
      // Protected by permission check inside component
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

// Export the required permission for use in components
export const REQUIRED_PERMISSION = authPermissions.applicationsManage.id;

export default apiDocsPlugin;
