import {
  createFrontendPlugin,
  createSlotExtension,
  DashboardSlot,
} from "@checkstack/frontend-api";
import { Wrench } from "lucide-react";
import {
  maintenanceRoutes,
  pluginMetadata,
  maintenanceAccess,
} from "@checkstack/maintenance-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemSignalsSlot,
} from "@checkstack/catalog-common";
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: maintenanceRoutes.routes.config,
      load: () =>
        import("./pages/MaintenanceConfigPage").then((m) => ({
          default: m.MaintenanceConfigPage,
        })),
      title: "Maintenances",
      accessRule: maintenanceAccess.maintenance.manage,
      nav: { group: "Reliability", icon: Wrench },
    },
    {
      route: maintenanceRoutes.routes.systemHistory,
      load: () =>
        import("./pages/SystemMaintenanceHistoryPage").then((m) => ({
          default: m.SystemMaintenanceHistoryPage,
        })),
      title: "System Maintenance History",
    },
    {
      route: maintenanceRoutes.routes.detail,
      load: () =>
        import("./pages/MaintenanceDetailPage").then((m) => ({
          default: m.MaintenanceDetailPage,
        })),
      title: "Maintenance Details",
      // Read-gated; anonymous holds this by default (isPublic), admin-revocable.
      accessRule: maintenanceAccess.maintenance.read,
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "maintenance.system-maintenance-badge",
      component: SystemMaintenanceBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "maintenance.system-details-top.panel",
      component: SystemMaintenancePanel,
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "maintenance.dashboard.signals",
      load: () =>
        import("./components/MaintenanceSignalsFiller").then((m) => ({
          default: m.MaintenanceSignalsFiller,
        })),
    }),
    {
      // Forward-looking companion to the in-progress signals: surfaces upcoming
      // (scheduled) maintenance windows on the dashboard so operators can see
      // planned work at a glance. Priority 20 places it between System health
      // (10) and Recent activity (30). Lazy so it stays out of the initial
      // bundle; renders nothing when there is nothing upcoming.
      id: "maintenance.dashboard.upcoming",
      slot: DashboardSlot,
      metadata: { priority: 20 },
      load: () =>
        import("./components/DashboardUpcomingMaintenances").then((m) => ({
          default:
            m.DashboardUpcomingMaintenances as React.ComponentType<unknown>,
        })),
    },
  ],
});
