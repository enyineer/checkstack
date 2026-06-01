import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
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
      load: () =>
        import("./pages/InfrastructureConfigPage").then((m) => ({
          default: m.InfrastructureConfigPage,
        })),
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
