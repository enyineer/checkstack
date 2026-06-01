import {
  createFrontendPlugin,
  createSlotExtension,
  NavbarRightSlot,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  notificationRoutes,
  pluginMetadata,
} from "@checkstack/notification-common";
import { lazy } from "react";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationUserMenuItems } from "./components/UserMenuItems";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const NotificationSettingsPage = lazy(() =>
  import("./pages/NotificationSettingsPage").then((m) => ({
    default: m.NotificationSettingsPage,
  })),
);
const DeliveryAttemptsPage = lazy(() =>
  import("./pages/DeliveryAttemptsPage").then((m) => ({
    default: m.DeliveryAttemptsPage,
  })),
);

// Plugin-extensible kind registry — domain frontends call `registerSubjectKind`
// at module load to bind their kinds (e.g., "catalog.system") to icon + label.
export {
  registerSubjectKind,
  getSubjectKindRenderer,
} from "./components/SubjectKindRegistry";
export type { SubjectKindRenderer } from "./components/SubjectKindRegistry";
export { NotificationSubjects } from "./components/NotificationSubjects";
export {
  SubscriptionRow,
  type SubscriptionRowProps,
  type ResolvedInheritance,
} from "./components/SubscriptionRow";
export {
  NotificationSubscriptionsManager,
  type NotificationSubscriptionsManagerProps,
} from "./components/NotificationSubscriptionsManager";
export {
  registerSubscriptionSubControls,
  getSubscriptionSubControls,
  type SubscriptionSubControlsComponent,
} from "./components/SubscriptionSubControlsRegistry";

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
    {
      route: notificationRoutes.routes.deliveryAttempts,
      element: <DeliveryAttemptsPage />,
    },
  ],
  extensions: [
    {
      id: "notification.navbar.bell",
      slot: NavbarRightSlot,
      component: NotificationBell,
    },
    createSlotExtension(UserMenuItemsSlot, {
      id: "notification.user.setting",
      component: NotificationUserMenuItems,
      metadata: { group: "Configuration" },
    }),
  ],
});
