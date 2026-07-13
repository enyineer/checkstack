import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { Activity } from "lucide-react";
import { SystemHealthCheckAssignment } from "./components/SystemHealthCheckAssignment";
import { SystemHealthBadge } from "./components/SystemHealthBadge";
import { healthCheckAccess } from "@checkstack/healthcheck-common";
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

// Contribution point for editor dropdown resolvers: a plugin owning a strategy
// with `x-options-resolver` config fields contributes a factory here.
export {
  HealthCheckConfigOptionsResolverSlot,
  type ConfigOptionsResolverContext,
  type ConfigOptionsResolverFactory,
  type ConfigOptionsResolverMetadata,
} from "./components/editor/options-resolvers";

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
      // management route even without the global manage rule. `parentType`
      // additionally admits SYSTEM managers: the catalog's per-system
      // "Manage health checks" link lands here (filtered to their system),
      // and the filtered view loads via the system-read-gated
      // `getSystemConfigurations`.
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
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
      // its edit route without the global manage rule. `parentType`
      // additionally admits SYSTEM managers: the editor hosts the per-system
      // Assignment section, and the backend authorizes those writes via a
      // `catalog.system` parent gate - a system manager must reach it. The
      // config side renders read-only for them (per-node gating inside).
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
      // Detailed run history is a MANAGER surface: global manage, a team
      // grant on a configuration, or manage on a SYSTEM (a system's owning
      // team sees its runs) - matches the page gate and the backend's
      // handler-side authorization of getDetailedHistory.
      accessRule: healthCheckAccess.configuration.manage,
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
    },
    {
      route: healthcheckRoutes.routes.historyDetail,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
      title: "Health Check Detail",
      // Same manager gate as the history list; the per-configuration data
      // procs authorize the (configuration, system) pair server-side.
      accessRule: healthCheckAccess.configuration.manage,
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
    },
    {
      route: healthcheckRoutes.routes.historyRun,
      load: () =>
        import("./pages/HealthCheckHistoryDetailPage").then((m) => ({
          default: m.HealthCheckHistoryDetailPage,
        })),
      title: "Health Check Run",
      // Same manager gate as the detail route - a team manager can open a run.
      accessRule: healthCheckAccess.configuration.manage,
      manageCapability: {
        objectType: healthCheckResourceTypes.configuration,
        parentType: catalogResourceTypes.system,
      },
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
      // Heavier overview (drawer pulls the chart kit + history table) — lazy
      // so it stays out of the initial bundle and loads when a system-detail
      // page renders.
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
