import {
  createFrontendPlugin,
  DashboardSlot,
} from "@checkstack/frontend-api";
import {
  announcementRoutes,
  pluginMetadata,
  announcementAccess,
  ANNOUNCEMENTS_WIDGET_ID,
} from "@checkstack/announcement-common";
import { defineStatusWidgetRenderer } from "@checkstack/status-page-common";
import { Megaphone } from "lucide-react";
import { DashboardAnnouncements } from "./components/DashboardAnnouncements";
import { StatusAnnouncementsWidget } from "./components/StatusAnnouncementsWidget";

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
    // Status-page "Announcements" widget renderer. The backend contributes the
    // widget TYPE + resolver; this draws the resolved public DTO.
    defineStatusWidgetRenderer({
      pluginMetadata,
      id: ANNOUNCEMENTS_WIDGET_ID,
      component: StatusAnnouncementsWidget,
    }),
  ],
});

// Re-export components for direct use in App.tsx
export { AnnouncementBanner } from "./components/AnnouncementBanner";
