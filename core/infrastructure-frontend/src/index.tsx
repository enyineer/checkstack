import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import { InfrastructureConfigPage } from "./pages/InfrastructureConfigPage";
import { InfrastructureUserMenuItems } from "./components/UserMenuItems";
import {
  pluginMetadata,
  infrastructureRoutes,
} from "@checkstack/infrastructure-common";

export const infrastructurePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: infrastructureRoutes.routes.config,
      element: <InfrastructureConfigPage />,
      // No accessRule here — the page handles per-tab access internally
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "infrastructure.user-menu.items",
      component: InfrastructureUserMenuItems,
      metadata: { group: "Configuration" },
    }),
  ],
});
