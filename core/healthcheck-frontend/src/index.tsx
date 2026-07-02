import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { Activity } from "lucide-react";
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
  CatalogBrowseHealthSlot,
  SystemSignalsSlot,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  healthcheckRoutes,
  pluginMetadata,
  healthCheckResourceTypes,
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
      // Team-scoped: creating/managing a health check via a team unlocks the
      // management route even without the global manage rule.
      manageCapability: { objectType: healthCheckResourceTypes.configuration },
      nav: {
        group: "Reliability",
        icon: Activity,
        // Visible to read-only users (the page itself still gates on manage).
        accessRule: healthCheckAccess.configuration.read,
      },
    },
    {
      route: healthcheckRoutes.routes.create,
      load: () =>
        import("./pages/StrategyPickerPage").then((m) => ({
          default: m.StrategyPickerPage,
        })),
      title: "Create Health Check",
      accessRule: healthCheckAccess.configuration.manage,
      // Team-scoped: a health-check creator, or anyone who manages the target
      // system (the backend authorizes create/assign via a `catalog.system`
      // parent gate), can reach the create flow without the global manage rule.
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
    },
    {
      route: healthcheckRoutes.routes.edit,
      load: () =>
        import("./pages/HealthCheckIDEPage").then((m) => ({
          default: m.HealthCheckIDEPage,
        })),
      title: "Edit Health Check",
      accessRule: healthCheckAccess.configuration.manage,
      // Team-scoped: managing an existing health check via a team grant unlocks
      // its edit route without the global manage rule.
      manageCapability: { objectType: healthCheckResourceTypes.configuration },
    },
    {
      route: healthcheckRoutes.routes.assignments,
      load: () =>
        import("./pages/AssignmentIDEPage").then((m) => ({
          default: m.AssignmentIDEPage,
        })),
      title: "Health Check Assignments",
      accessRule: healthCheckAccess.configuration.manage,
      // Team-scoped: assignment is reached per-system and the backend authorizes
      // it via a `catalog.system` parent gate, so a system manager (or a
      // health-check manager) can reach it without the global manage rule.
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
    },
    {
      route: healthcheckRoutes.routes.history,
      load: () =>
        import("./pages/HealthCheckHistoryPage").then((m) => ({
          default: m.HealthCheckHistoryPage,
        })),
      title: "Health Check History",
      accessRule: healthCheckAccess.configuration.read,
      // Team-scoped: a manager of a health check via a team grant can review its
      // run history without the global manage/read rule.
      manageCapability: { objectType: healthCheckResourceTypes.configuration },
    },
    {
      route: healthcheckRoutes.routes.historyDetail,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
      title: "Health Check Detail",
      accessRule: healthCheckAccess.details,
      // Team-scoped: managing a health check via a team grant unlocks its
      // detailed run history without the global manage/details rule.
      manageCapability: { objectType: healthCheckResourceTypes.configuration },
    },
    {
      route: healthcheckRoutes.routes.historyRun,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
      title: "Health Check Run",
      accessRule: healthCheckAccess.details,
      // Team-scoped: same as the detail route - a team manager can open a run.
      manageCapability: { objectType: healthCheckResourceTypes.configuration },
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "healthcheck.system-health-badge",
      component: SystemHealthBadge,
    }),
    createSlotExtension(CatalogBrowseHealthSlot, {
      id: "healthcheck.catalog.browse-health",
      // Lazy: only loads when the catalog browse/manage view mounts the slot.
      load: () =>
        import("./components/CatalogBrowseHealthFiller").then((m) => ({
          default: m.CatalogBrowseHealthFiller,
        })),
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "healthcheck.dashboard.signals",
      // Lazy: only loads when the dashboard overview mounts the slot.
      load: () =>
        import("./components/HealthSignalsFiller").then((m) => ({
          default: m.HealthSignalsFiller,
        })),
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
