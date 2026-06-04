import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  integrationRoutes,
  pluginMetadata,
  integrationAccess,
} from "@checkstack/integration-common";
import { Webhook } from "lucide-react";

/**
 * Integration frontend — now scoped to connection management. The
 * legacy subscription / delivery-log pages were removed when the
 * platform moved to the Automation Platform model; operators manage
 * automations in `/automation/...` instead. The landing page lists
 * providers and links each to its connection-management page.
 */
export const integrationPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: integrationRoutes.routes.list,
      load: () =>
        import("./pages/IntegrationsLandingPage").then((m) => ({
          default: m.IntegrationsLandingPage,
        })),
      accessRule: integrationAccess.manage,
      nav: {
        group: "Configuration",
        icon: Webhook,
        label: "Integrations",
      },
    },
    {
      route: integrationRoutes.routes.connections,
      load: () =>
        import("./pages/ProviderConnectionsPage").then((m) => ({
          default: m.ProviderConnectionsPage,
        })),
      accessRule: integrationAccess.manage,
    },
  ],
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
