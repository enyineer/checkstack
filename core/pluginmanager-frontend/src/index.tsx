import { createFrontendPlugin } from "@checkstack/frontend-api";
import { Puzzle } from "lucide-react";
import {
  pluginMetadata,
  pluginManagerRoutes,
  pluginManagerAccess,
} from "@checkstack/pluginmanager-common";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: pluginManagerRoutes.routes.installed,
      load: () =>
        import("./pages/InstalledPluginsPage").then((m) => ({
          default: m.InstalledPluginsPage,
        })),
      title: "Plugin Manager",
      accessRule: pluginManagerAccess.view,
      nav: {
        group: "Platform",
        icon: Puzzle,
      },
    },
    {
      route: pluginManagerRoutes.routes.install,
      load: () =>
        import("./pages/InstallPluginPage").then((m) => ({
          default: m.InstallPluginPage,
        })),
      title: "Install plugin",
      accessRule: pluginManagerAccess.install,
    },
    {
      route: pluginManagerRoutes.routes.events,
      load: () =>
        import("./pages/PluginEventsPage").then((m) => ({
          default: m.PluginEventsPage,
        })),
      title: "Plugin events",
      accessRule: pluginManagerAccess.view,
    },
  ],
});
