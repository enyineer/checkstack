import {
  createFrontendPlugin,
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
      path: "/healthcheck/config",
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
    {
      id: "healthcheck.system-details.history",
      slotId: SystemDetailsSlot.id,
      component: HealthCheckHistory,
    },
    {
      id: "healthcheck.catalog.system-actions",
      slotId: CatalogSystemActionsSlot.id,
      component: SystemHealthCheckAssignment,
    },
  ],
});
