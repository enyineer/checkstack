import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";
import { SystemHealthBadge } from "./components/SystemHealthBadge";
import { healthCheckAccess } from "@checkstack/healthcheck-common";
// Import directly from the extension module, NOT the `./auto-charts` barrel:
// the barrel statically re-exports AutoChartGrid + SingleRunChartGrid (both
// pull in recharts), so importing the extension through it would drag recharts
// into this eagerly-loaded plugin entry. The extension itself lazy-loads the
// chart grid.
import { autoChartExtension } from "./auto-charts/extension";

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
  AssignmentIDENodeSlot,
  AssignmentIDEPanelSlot,
  HealthCheckConfigIDENodeSlot,
  HealthCheckConfigIDEPanelSlot,
  type HealthCheckDiagramSlotContext,
  type AssignmentIDEContext,
  type HealthCheckConfigIDEContext,
  createDiagramExtensionFactory,
  type TypedAggregatedBucket,
} from "./slots";

// Export hooks for reusable data fetching
export { useHealthCheckData } from "./hooks";
export { useStrategySchemas } from "./auto-charts/useStrategySchemas";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: healthcheckRoutes.routes.config,
      load: () =>
        import("./pages/HealthCheckConfigPage").then((m) => ({
          default: m.HealthCheckConfigPage,
        })),
      title: "Health Checks",
      accessRule: healthCheckAccess.configuration.manage,
    },
    {
      route: healthcheckRoutes.routes.create,
      load: () =>
        import("./pages/StrategyPickerPage").then((m) => ({
          default: m.StrategyPickerPage,
        })),
      title: "Create Health Check",
      accessRule: healthCheckAccess.configuration.manage,
    },
    {
      route: healthcheckRoutes.routes.edit,
      load: () =>
        import("./pages/HealthCheckIDEPage").then((m) => ({
          default: m.HealthCheckIDEPage,
        })),
      title: "Edit Health Check",
      accessRule: healthCheckAccess.configuration.manage,
    },
    {
      route: healthcheckRoutes.routes.assignments,
      load: () =>
        import("./pages/AssignmentIDEPage").then((m) => ({
          default: m.AssignmentIDEPage,
        })),
      title: "Health Check Assignments",
      accessRule: healthCheckAccess.configuration.manage,
    },
    {
      route: healthcheckRoutes.routes.history,
      load: () =>
        import("./pages/HealthCheckHistoryPage").then((m) => ({
          default: m.HealthCheckHistoryPage,
        })),
      title: "Health Check History",
      accessRule: healthCheckAccess.configuration.read,
    },
    {
      route: healthcheckRoutes.routes.historyDetail,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
      title: "Health Check Detail",
      accessRule: healthCheckAccess.details,
    },
    {
      route: healthcheckRoutes.routes.historyRun,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
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
      metadata: { group: "Reliability" },
    }),
    createSlotExtension(SystemStateBadgesSlot, {
      id: "healthcheck.system-health-badge",
      component: SystemHealthBadge,
    }),
    createSlotExtension(SystemDetailsSlot, {
      id: "healthcheck.system-details.overview",
      // Heavier overview (drawer pulls recharts) — lazy so it stays out of the
      // initial bundle and loads when a system-detail page renders.
      load: () =>
        import("./components/HealthCheckSystemOverview").then((m) => ({
          default: m.HealthCheckSystemOverview,
        })),
    }),
    createSlotExtension(CatalogSystemActionsSlot, {
      id: "healthcheck.catalog.system-actions",
      component: SystemHealthCheckAssignment,
    }),
    // Auto-generated charts based on schema metadata
    autoChartExtension,
  ],
});
