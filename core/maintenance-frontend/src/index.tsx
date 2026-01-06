import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import { maintenanceApiRef, type MaintenanceApiClient } from "./api";
import {
  maintenanceRoutes,
  MaintenanceApi,
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/maintenance-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkmate-monitor/catalog-common";
import { MaintenanceConfigPage } from "./pages/MaintenanceConfigPage";
import { SystemMaintenanceHistoryPage } from "./pages/SystemMaintenanceHistoryPage";
import { MaintenanceDetailPage } from "./pages/MaintenanceDetailPage";
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";
import { MaintenanceMenuItems } from "./components/MaintenanceMenuItems";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: maintenanceRoutes.routes.config,
      element: <MaintenanceConfigPage />,
      title: "Maintenances",
      permission: permissions.maintenanceManage,
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
  apis: [
    {
      ref: maintenanceApiRef,
      factory: (deps: {
        get: <T>(ref: ApiRef<T>) => T;
      }): MaintenanceApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin(MaintenanceApi);
      },
    },
  ],
  extensions: [
    {
      id: "maintenance.user-menu.items",
      slot: UserMenuItemsSlot,
      component: MaintenanceMenuItems,
    },
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
