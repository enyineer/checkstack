import {
  createFrontendPlugin,
  NavbarSlot,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import {
  notificationRoutes,
  pluginMetadata,
} from "@checkmate-monitor/notification-common";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationsPage } from "./pages/NotificationsPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { NotificationUserMenuItems } from "./components/UserMenuItems";

export const notificationPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: notificationRoutes.routes.home,
      element: <NotificationsPage />,
    },
    {
      route: notificationRoutes.routes.settings,
      element: <NotificationSettingsPage />,
    },
  ],
  extensions: [
    {
      id: "notification.navbar.bell",
      slot: NavbarSlot,
      component: NotificationBell,
    },
    {
      id: "notification.user.setting",
      slot: UserMenuItemsSlot,
      component: NotificationUserMenuItems,
    },
  ],
});
