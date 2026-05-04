import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
  DashboardSlot,
} from "@checkstack/frontend-api";
import {
  announcementRoutes,
  pluginMetadata,
  announcementAccess,
} from "@checkstack/announcement-common";
import { AnnouncementManagePage } from "./pages/AnnouncementManagePage";
import { AnnouncementMenuItems } from "./components/AnnouncementMenuItems";
import { DashboardAnnouncements } from "./components/DashboardAnnouncements";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: announcementRoutes.routes.manage,
      element: <AnnouncementManagePage />,
      title: "Manage Announcements",
      accessRule: announcementAccess.manage,
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "announcement.user-menu.items",
      component: AnnouncementMenuItems,
      group: "Workspace",
    }),
    {
      id: "announcement.dashboard.cards",
      slot: DashboardSlot,
      component:
        DashboardAnnouncements as React.ComponentType<unknown>,
    },
  ],
});

// Re-export components for direct use in App.tsx
export { AnnouncementBanner } from "./components/AnnouncementBanner";
