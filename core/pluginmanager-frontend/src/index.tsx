import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  pluginMetadata,
  pluginManagerRoutes,
  pluginManagerAccess,
} from "@checkstack/pluginmanager-common";
import { lazy } from "react";
import { PluginManagerMenuItem } from "./PluginManagerMenuItem";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const InstalledPluginsPage = lazy(() =>
  import("./pages/InstalledPluginsPage").then((m) => ({
    default: m.InstalledPluginsPage,
  })),
);
const InstallPluginPage = lazy(() =>
  import("./pages/InstallPluginPage").then((m) => ({
    default: m.InstallPluginPage,
  })),
);
const PluginEventsPage = lazy(() =>
  import("./pages/PluginEventsPage").then((m) => ({
    default: m.PluginEventsPage,
  })),
);

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: pluginManagerRoutes.routes.installed,
      element: <InstalledPluginsPage />,
      title: "Plugin Manager",
      accessRule: pluginManagerAccess.view,
    },
    {
      route: pluginManagerRoutes.routes.install,
      element: <InstallPluginPage />,
      title: "Install plugin",
      accessRule: pluginManagerAccess.install,
    },
    {
      route: pluginManagerRoutes.routes.events,
      element: <PluginEventsPage />,
      title: "Plugin events",
      accessRule: pluginManagerAccess.view,
    },
  ],
  extensions: [
    {
      id: "pluginmanager.user-menu.link",
      slot: UserMenuItemsSlot,
      component: PluginManagerMenuItem,
      metadata: { group: "Configuration" },
    },
  ],
});
