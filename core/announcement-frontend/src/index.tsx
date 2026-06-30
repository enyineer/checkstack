import {
  createFrontendPlugin,
  DashboardSlot,
} from "@checkstack/frontend-api";
import {
  announcementRoutes,
  pluginMetadata,
  announcementAccess,
} from "@checkstack/announcement-common";
import { Megaphone } from "lucide-react";
import { DashboardAnnouncements } from "./components/DashboardAnnouncements";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: announcementRoutes.routes.manage,
      load: () =>
        import("./pages/AnnouncementManagePage").then((m) => ({
          default: m.AnnouncementManagePage,
        })),
      title: "Manage Announcements",
      accessRule: announcementAccess.manage,
      nav: { group: "Workspace", icon: Megaphone, label: "Announcements" },
    },
  ],
  apis: [],
  extensions: [
    {
      id: "announcement.dashboard.cards",
      slot: DashboardSlot,
      metadata: { priority: 5 },
      component:
        DashboardAnnouncements as React.ComponentType<unknown>,
    },
  ],
});

// Re-export components for direct use in App.tsx
export { AnnouncementBanner } from "./components/AnnouncementBanner";
