import {
  createFrontendPlugin,
  createSlotExtension,
  NavbarRightSlot,
} from "@checkstack/frontend-api";
import {
  notificationRoutes,
  pluginMetadata,
} from "@checkstack/notification-common";
import { CatalogBrowseDataBoundarySlot } from "@checkstack/catalog-common";
import { Bell } from "lucide-react";
import { NotificationBell } from "./components/NotificationBell";
import { BulkSubscriptionStatusProvider } from "./components/BulkSubscriptionStatusProvider";

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
export {
  BulkSubscriptionStatusProvider,
  useBulkSubscriptionStatusOptional,
  type BulkSubscriptionStatusContextValue,
  type BulkSubscriptionStatusProviderProps,
} from "./components/BulkSubscriptionStatusProvider";

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
      nav: {
        group: "Settings",
        icon: Bell,
        label: "Notification Settings",
        // Notifications are per-user (channels + subscriptions), so this page is
        // meaningless to anonymous users - they can't receive notifications.
        // Show it only to authenticated users (admin sub-sections inside the
        // page remain separately gated by notificationAccess.admin).
        isVisible: ({ isAuthenticated }) => isAuthenticated,
      },
    },
    {
      route: notificationRoutes.routes.subscriptions,
      load: () =>
        import("./pages/NotificationSubscriptionsPage").then((m) => ({
          default: m.NotificationSubscriptionsPage,
        })),
      nav: {
        group: "Settings",
        icon: Bell,
        label: "Your Subscriptions",
        // Subscriptions are per-user, so the surface is meaningless to
        // anonymous users - mirror the settings page's authenticated-only gate.
        isVisible: ({ isAuthenticated }) => isAuthenticated,
      },
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
    // Fills catalog's browse-view data boundary: wraps the whole browse tree in
    // the bulk subscription-status provider so every system row's / group
    // header's collapsed notification bell reads its subscribed state from ONE
    // shared query instead of firing its own per-bell request (fixes the N+1).
    // Eager so the provider is in place before the first bell renders and no
    // bell falls back to its singular query.
    createSlotExtension(CatalogBrowseDataBoundarySlot, {
      id: "notification.catalog.browse-subscription-status",
      component: BulkSubscriptionStatusProvider,
    }),
  ],
});
