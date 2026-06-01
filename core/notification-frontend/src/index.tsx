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
import { NotificationBell } from "./components/NotificationBell";
import { NotificationUserMenuItems } from "./components/UserMenuItems";

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
      load: () =>
        import("./pages/NotificationsPage").then((m) => ({
          default: m.NotificationsPage,
        })),
    },
    {
      route: notificationRoutes.routes.settings,
      load: () =>
        import("./pages/NotificationSettingsPage").then((m) => ({
          default: m.NotificationSettingsPage,
        })),
    },
    {
      route: notificationRoutes.routes.deliveryAttempts,
      load: () =>
        import("./pages/DeliveryAttemptsPage").then((m) => ({
          default: m.DeliveryAttemptsPage,
        })),
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
