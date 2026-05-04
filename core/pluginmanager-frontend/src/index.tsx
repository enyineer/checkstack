import {
  createFrontendPlugin,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  pluginMetadata,
  pluginManagerRoutes,
  pluginManagerAccess,
} from "@checkstack/pluginmanager-common";
import { InstalledPluginsPage } from "./pages/InstalledPluginsPage";
import { InstallPluginPage } from "./pages/InstallPluginPage";
import { PluginEventsPage } from "./pages/PluginEventsPage";
import { PluginManagerMenuItem } from "./PluginManagerMenuItem";

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
