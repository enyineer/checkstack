import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import { lazy } from "react";
import { InfrastructureUserMenuItems } from "./components/UserMenuItems";
import {
  pluginMetadata,
  infrastructureRoutes,
} from "@checkstack/infrastructure-common";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const InfrastructureConfigPage = lazy(() =>
  import("./pages/InfrastructureConfigPage").then((m) => ({
    default: m.InfrastructureConfigPage,
  })),
);

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
