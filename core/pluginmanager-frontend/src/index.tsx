import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  pluginMetadata,
  pluginManagerRoutes,
  pluginManagerAccess,
} from "@checkstack/pluginmanager-common";
import { PluginManagerMenuItem } from "./PluginManagerMenuItem";

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
  extensions: [
    {
      id: "pluginmanager.user-menu.link",
      slot: UserMenuItemsSlot,
      component: PluginManagerMenuItem,
      metadata: { group: "Configuration" },
    },
  ],
});
