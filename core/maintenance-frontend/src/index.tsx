import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
  UserMenuItemsSlot,
} from "@checkmate/frontend-api";
import { maintenanceApiRef, type MaintenanceApi } from "./api";
import { maintenanceRoutes } from "@checkmate/maintenance-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkmate/catalog-common";
import { MaintenanceConfigPage } from "./pages/MaintenanceConfigPage";
import { SystemMaintenanceHistoryPage } from "./pages/SystemMaintenanceHistoryPage";
import { MaintenanceDetailPage } from "./pages/MaintenanceDetailPage";
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";
import { MaintenanceMenuItems } from "./components/MaintenanceMenuItems";

export default createFrontendPlugin({
  name: "maintenance-frontend",
  routes: [
    {
      route: maintenanceRoutes.routes.config,
      element: <MaintenanceConfigPage />,
      title: "Maintenances",
      permission: "maintenance-backend.maintenance.manage",
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
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): MaintenanceApi => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin<MaintenanceApi>("maintenance-backend");
      },
    },
  ],
  extensions: [
    {
      id: "maintenance.user-menu.items",
      slotId: UserMenuItemsSlot.id,
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
