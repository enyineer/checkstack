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
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";
import { MaintenanceMenuItems } from "./components/MaintenanceMenuItems";

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
