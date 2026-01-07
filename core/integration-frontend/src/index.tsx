import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import {
  integrationRoutes,
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/integration-common";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { DeliveryLogsPage } from "./pages/DeliveryLogsPage";
import { SubscriptionDetailPage } from "./pages/SubscriptionDetailPage";
import { ProviderConnectionsPage } from "./pages/ProviderConnectionsPage";
import { IntegrationMenuItem } from "./components/IntegrationMenuItem";

export const integrationPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: integrationRoutes.routes.list,
      element: <IntegrationsPage />,
      permission: permissions.integrationManage,
    },
    {
      route: integrationRoutes.routes.logs,
      element: <DeliveryLogsPage />,
      permission: permissions.integrationManage,
    },
    {
      route: integrationRoutes.routes.detail,
      element: <SubscriptionDetailPage />,
      permission: permissions.integrationManage,
    },
    {
      route: integrationRoutes.routes.connections,
      element: <ProviderConnectionsPage />,
      permission: permissions.integrationManage,
    },
  ],
  extensions: [
    {
      id: "integration.user-menu.link",
      slot: UserMenuItemsSlot,
      component: IntegrationMenuItem,
    },
  ],
});

export default integrationPlugin;

// Re-export registry and types for providers to register custom config components
export {
  registerProviderConfigExtension,
  getProviderConfigExtension,
  hasProviderConfigExtension,
} from "./provider-config-registry";

export type {
  ProviderConfigProps,
  ProviderConfigExtension,
} from "./provider-config-registry";
