import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  integrationRoutes,
  pluginMetadata,
  integrationAccess,
} from "@checkstack/integration-common";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { DeliveryLogsPage } from "./pages/DeliveryLogsPage";
import { ProviderConnectionsPage } from "./pages/ProviderConnectionsPage";
import { IntegrationMenuItem } from "./components/IntegrationMenuItem";

export const integrationPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: integrationRoutes.routes.list,
      element: <IntegrationsPage />,
      accessRule: integrationAccess.manage,
    },
    {
      route: integrationRoutes.routes.logs,
      element: <DeliveryLogsPage />,
      accessRule: integrationAccess.manage,
    },
    {
      route: integrationRoutes.routes.deliveryLogs,
      element: <DeliveryLogsPage />,
      accessRule: integrationAccess.manage,
    },
    {
      route: integrationRoutes.routes.connections,
      element: <ProviderConnectionsPage />,
      accessRule: integrationAccess.manage,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "integration.user-menu.link",
      component: IntegrationMenuItem,
    }),
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
