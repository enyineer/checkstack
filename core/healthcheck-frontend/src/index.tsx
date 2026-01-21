import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckHistoryPage } from "./pages/HealthCheckHistoryPage";
import { HealthCheckHistoryDetailPage } from "./pages/HealthCheckHistoryDetailPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { HealthCheckSystemOverview } from "./components/HealthCheckSystemOverview";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";
import { SystemHealthBadge } from "./components/SystemHealthBadge";
import { healthCheckAccess } from "@checkstack/healthcheck-common";
import { autoChartExtension } from "./auto-charts";

import {
  SystemDetailsSlot,
  CatalogSystemActionsSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import {
  healthcheckRoutes,
  pluginMetadata,
} from "@checkstack/healthcheck-common";

// Export slot definitions for other plugins to use
export {
  HealthCheckDiagramSlot,
  createDiagramExtensionFactory,
  type HealthCheckDiagramSlotContext,
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
      accessRule: healthCheckAccess.configuration.manage,
    },
    {
      route: healthcheckRoutes.routes.history,
      element: <HealthCheckHistoryPage />,
      title: "Health Check History",
      accessRule: healthCheckAccess.configuration.read,
    },
    {
      route: healthcheckRoutes.routes.historyDetail,
      element: <HealthCheckHistoryDetailPage />,
      title: "Health Check Detail",
      accessRule: healthCheckAccess.details,
    },
    {
      route: healthcheckRoutes.routes.historyRun,
      element: <HealthCheckHistoryDetailPage />,
      title: "Health Check Run",
      accessRule: healthCheckAccess.details,
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "healthcheck.user-menu.items",
      component: HealthCheckMenuItems,
    }),
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
