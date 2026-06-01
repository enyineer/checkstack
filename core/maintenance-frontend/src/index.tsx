import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  maintenanceRoutes,
  pluginMetadata,
  maintenanceAccess,
} from "@checkstack/maintenance-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import { lazy } from "react";
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";
import { MaintenanceMenuItems } from "./components/MaintenanceMenuItems";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const MaintenanceConfigPage = lazy(() =>
  import("./pages/MaintenanceConfigPage").then((m) => ({
    default: m.MaintenanceConfigPage,
  })),
);
const SystemMaintenanceHistoryPage = lazy(() =>
  import("./pages/SystemMaintenanceHistoryPage").then((m) => ({
    default: m.SystemMaintenanceHistoryPage,
  })),
);
const MaintenanceDetailPage = lazy(() =>
  import("./pages/MaintenanceDetailPage").then((m) => ({
    default: m.MaintenanceDetailPage,
  })),
);

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: maintenanceRoutes.routes.config,
      element: <MaintenanceConfigPage />,
      title: "Maintenances",
      accessRule: maintenanceAccess.maintenance.manage,
    },
    {
      route: maintenanceRoutes.routes.systemHistory,
      element: <SystemMaintenanceHistoryPage />,
      title: "System Maintenance History",
    },
    {
      route: maintenanceRoutes.routes.detail,
      element: <MaintenanceDetailPage />,
      title: "Maintenance Details",
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "maintenance.user-menu.items",
      component: MaintenanceMenuItems,
      metadata: { group: "Reliability" },
    }),
    createSlotExtension(SystemStateBadgesSlot, {
      id: "maintenance.system-maintenance-badge",
      component: SystemMaintenanceBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "maintenance.system-details-top.panel",
      component: SystemMaintenancePanel,
    }),
  ],
});
