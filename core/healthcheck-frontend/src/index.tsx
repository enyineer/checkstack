import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import { healthCheckApiRef, type HealthCheckApiClient } from "./api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckHistoryPage } from "./pages/HealthCheckHistoryPage";
import { HealthCheckHistoryDetailPage } from "./pages/HealthCheckHistoryDetailPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { HealthCheckSystemOverview } from "./components/HealthCheckSystemOverview";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";
import { SystemHealthBadge } from "./components/SystemHealthBadge";
import { permissions } from "@checkmate-monitor/healthcheck-common";
import { autoChartExtension } from "./auto-charts";

import {
  SystemDetailsSlot,
  CatalogSystemActionsSlot,
  SystemStateBadgesSlot,
} from "@checkmate-monitor/catalog-common";
import {
  healthcheckRoutes,
  HealthCheckApi,
  pluginMetadata,
} from "@checkmate-monitor/healthcheck-common";

// Export slot definitions for other plugins to use
export {
  HealthCheckDiagramSlot,
  createStrategyDiagramExtension,
  createDiagramExtensionFactory,
  type HealthCheckDiagramSlotContext,
  type RawDiagramContext,
  type AggregatedDiagramContext,
  type TypedHealthCheckRun,
  type TypedAggregatedBucket,
} from "./slots";

// Export hooks for reusable data fetching
export { useHealthCheckData } from "./hooks";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: healthcheckRoutes.routes.config,
      element: <HealthCheckConfigPage />,
      title: "Health Checks",
      permission: permissions.healthCheckManage,
    },
    {
      route: healthcheckRoutes.routes.history,
      element: <HealthCheckHistoryPage />,
      title: "Health Check History",
      permission: permissions.healthCheckRead,
    },
    {
      route: healthcheckRoutes.routes.historyDetail,
      element: <HealthCheckHistoryDetailPage />,
      title: "Health Check Detail",
      permission: permissions.healthCheckDetailsRead,
    },
  ],
  apis: [
    {
      ref: healthCheckApiRef,
      factory: (deps: {
        get: <T>(ref: ApiRef<T>) => T;
      }): HealthCheckApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        // HealthCheckApiClient is just the RPC contract - return it directly
        return rpcApi.forPlugin(HealthCheckApi);
      },
    },
  ],
  extensions: [
    {
      id: "healthcheck.user-menu.items",
      slot: UserMenuItemsSlot,
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
    // Auto-generated charts based on schema metadata
    autoChartExtension,
  ],
});
