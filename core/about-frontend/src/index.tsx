import {
  createFrontendPlugin,
  UserMenuItemsBottomSlot,
} from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import { pluginMetadata } from "@checkstack/about-common";
import { lazy } from "react";
import { AboutMenuItem } from "./AboutMenuItem";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const AboutPage = lazy(() =>
  import("./AboutPage").then((m) => ({ default: m.AboutPage })),
);

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
