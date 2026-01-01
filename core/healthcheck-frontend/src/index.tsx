import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
  UserMenuItemsSlot,
} from "@checkmate/frontend-api";
import { healthCheckApiRef, type HealthCheckApi } from "./api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { HealthCheckSystemOverview } from "./components/HealthCheckSystemOverview";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";
import { SystemHealthBadge } from "./components/SystemHealthBadge";

import {
  SystemDetailsSlot,
  CatalogSystemActionsSlot,
  SystemStateBadgesSlot,
} from "@checkmate/catalog-common";
import { healthcheckRoutes } from "@checkmate/healthcheck-common";

export default createFrontendPlugin({
  name: "healthcheck-frontend",
  routes: [
    {
      route: healthcheckRoutes.routes.config,
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
      slotId: UserMenuItemsSlot.id,
      component: HealthCheckMenuItems,
    },
    createSlotExtension(SystemStateBadgesSlot, {
      id: "healthcheck.system-health-badge",
      component: SystemHealthBadge,
    }),
    createSlotExtension(SystemDetailsSlot, {
      id: "healthcheck.system-details.overview",
      component: HealthCheckSystemOverview,
    }),
    createSlotExtension(CatalogSystemActionsSlot, {
      id: "healthcheck.catalog.system-actions",
      component: SystemHealthCheckAssignment,
    }),
  ],
});
