import { createFrontendPlugin } from "@checkmate/frontend-api";
import { SLOT_NAVBAR, SLOT_USER_MENU_ITEMS } from "@checkmate/common";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationsPage } from "./pages/NotificationsPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { NotificationUserMenuItems } from "./components/UserMenuItems";

export const notificationPlugin = createFrontendPlugin({
  name: "notification-frontend",
  routes: [
    {
      path: "/",
      element: <NotificationsPage />,
    },
    {
      path: "/settings",
      element: <NotificationSettingsPage />,
    },
  ],
  extensions: [
    {
      id: "notification.navbar.bell",
      slotId: SLOT_NAVBAR,
      component: NotificationBell,
    },
    {
      id: "notification.user.setting",
      slotId: SLOT_USER_MENU_ITEMS,
      component: NotificationUserMenuItems,
    },
  ],
});
