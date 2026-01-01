import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
} from "@checkmate/frontend-api";
import { healthCheckApiRef, type HealthCheckApi } from "./api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { HealthCheckHistory } from "./components/HealthCheckHistory";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";

import { SLOT_USER_MENU_ITEMS } from "@checkmate/common";
import {
  SystemDetailsSlot,
  CatalogSystemActionsSlot,
} from "@checkmate/catalog-common";

export default createFrontendPlugin({
  name: "healthcheck-frontend",
  routes: [
    {
      path: "/config",
      element: <HealthCheckConfigPage />,
      title: "Health Checks",
      permission: "healthcheck.read",
    },
  ],
  apis: [
    {
      ref: healthCheckApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): HealthCheckApi => {
        const rpcApi = deps.get(rpcApiRef);
        // HealthCheckApi is just the RPC contract - return it directly
        return rpcApi.forPlugin<HealthCheckApi>("healthcheck-backend");
      },
    },
  ],
  extensions: [
    {
      id: "healthcheck.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: HealthCheckMenuItems,
    },
    createSlotExtension(SystemDetailsSlot, {
      id: "healthcheck.system-details.history",
      component: HealthCheckHistory,
    }),
    createSlotExtension(CatalogSystemActionsSlot, {
      id: "healthcheck.catalog.system-actions",
      component: SystemHealthCheckAssignment,
    }),
  ],
});
