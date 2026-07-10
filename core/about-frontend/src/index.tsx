import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import { pluginMetadata } from "@checkstack/about-common";
import { AboutMenuItem } from "./AboutMenuItem";

export const aboutRoutes = createRoutes(pluginMetadata.pluginId, {
  page: "/",
});

export const aboutPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: aboutRoutes.routes.page,
      load: () => import("./AboutPage").then((m) => ({ default: m.AboutPage })),
    },
  ],
  extensions: [
    {
      id: "about.user-menu.link",
      slot: UserMenuItemsSlot,
      // Sits below the appearance toggles, above Logout.
      metadata: { priority: 40 },
      component: AboutMenuItem,
    },
  ],
});

export default aboutPlugin;
