import {
  createFrontendPlugin,
  UserMenuItemsBottomSlot,
} from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import { pluginMetadata } from "@checkstack/about-common";
import { AboutPage } from "./AboutPage";
import { AboutMenuItem } from "./AboutMenuItem";

export const aboutRoutes = createRoutes(pluginMetadata.pluginId, {
  page: "/",
});

export const aboutPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: aboutRoutes.routes.page,
      element: <AboutPage />,
    },
  ],
  extensions: [
    {
      id: "about.user-menu.link",
      slot: UserMenuItemsBottomSlot,
      component: AboutMenuItem,
    },
  ],
});

export default aboutPlugin;
