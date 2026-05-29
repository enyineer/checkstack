import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  integrationRoutes,
  pluginMetadata,
  integrationAccess,
} from "@checkstack/integration-common";
import { ProviderConnectionsPage } from "./pages/ProviderConnectionsPage";

/**
 * Integration frontend — now scoped to connection management. The
 * legacy subscription / delivery-log pages were removed when the
 * platform moved to the Automation Platform model; operators manage
 * automations in `/automation/...` instead.
 */
export const integrationPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: integrationRoutes.routes.connections,
      element: <ProviderConnectionsPage />,
      accessRule: integrationAccess.manage,
    },
  ],
  extensions: [],
});

export default integrationPlugin;

export {
  registerProviderConfigExtension,
  getProviderConfigExtension,
  hasProviderConfigExtension,
} from "./provider-config-registry";

export type {
  ProviderConfigProps,
  ProviderConfigExtension,
} from "./provider-config-registry";
