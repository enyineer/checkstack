import {
  createFrontendPlugin,
  createSlotExtension,
  DashboardSlot,
  NavbarRightSlot,
} from "@checkstack/frontend-api";
import { Wrench } from "lucide-react";
import {
  maintenanceRoutes,
  pluginMetadata,
  maintenanceAccess,
  maintenanceResourceTypes,
} from "@checkstack/maintenance-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemSignalsSlot,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { SystemMaintenancePanel } from "./components/SystemMaintenancePanel";
import { MaintenanceMentionRegistrar } from "./components/MaintenanceMentionRegistrar";
import { registerMaintenanceMentions } from "./utils/mentions";
import { SystemMaintenanceBadge } from "./components/SystemMaintenanceBadge";

// Registered at MODULE scope so every already-written maintenance mention
// resolves as soon as this plugin loads. The search half installs later (see
// the registrar).
registerMaintenanceMentions();

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      // Public, read-gated overview. Anonymous holds `maintenance.read` by
      // default, so this nav shows logged-out (Item 6). Managing/editing stays
      // on the separate manage-gated config route below.
      route: maintenanceRoutes.routes.overview,
      load: () =>
        import("./pages/MaintenanceOverviewPage").then((m) => ({
          default: m.MaintenanceOverviewPage,
        })),
      title: "Maintenances",
      accessRule: maintenanceAccess.maintenance.read,
      nav: { group: "Reliability", icon: Wrench, isVisible: () => true },
    },
    {
      route: maintenanceRoutes.routes.config,
      load: () =>
        import("./pages/MaintenanceConfigPage").then((m) => ({
          default: m.MaintenanceConfigPage,
        })),
      title: "Manage Maintenances",
      accessRule: maintenanceAccess.maintenance.manage,
      // Team-scoped: managing a system unlocks the maintenance surface for it.
      manageCapability: {
        objectType: maintenanceResourceTypes.maintenance,
        parentType: catalogResourceTypes.system,
      },
      nav: { group: "Reliability", icon: Wrench },
    },
    {
      route: maintenanceRoutes.routes.systemHistory,
      load: () =>
        import("./pages/SystemMaintenanceHistoryPage").then((m) => ({
          default: m.SystemMaintenanceHistoryPage,
        })),
      title: "System Maintenance History",
    },
    {
      route: maintenanceRoutes.routes.detail,
      load: () =>
        import("./pages/MaintenanceDetailPage").then((m) => ({
          default: m.MaintenanceDetailPage,
        })),
      title: "Maintenance Details",
      // Read-gated; anonymous holds this by default (isPublic), admin-revocable.
      accessRule: maintenanceAccess.maintenance.read,
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    // App-level slot, NOT a per-row one: this is a headless singleton issuing a
    // single query, and a per-row slot would mount it once per visible system.
    createSlotExtension(NavbarRightSlot, {
      id: "maintenance.mention-registrar",
      component: MaintenanceMentionRegistrar,
    }),
    createSlotExtension(SystemStateBadgesSlot, {
      id: "maintenance.system-maintenance-badge",
      component: SystemMaintenanceBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "maintenance.system-details-top.panel",
      component: SystemMaintenancePanel,
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "maintenance.dashboard.signals",
      load: () =>
        import("./components/MaintenanceSignalsFiller").then((m) => ({
          default: m.MaintenanceSignalsFiller,
        })),
    }),
    {
      // Forward-looking companion to the in-progress signals: surfaces upcoming
      // (scheduled) maintenance windows on the dashboard so operators can see
      // planned work at a glance. Priority 20 places it between System health
      // (10) and Recent activity (30). Lazy so it stays out of the initial
      // bundle; renders nothing when there is nothing upcoming.
      id: "maintenance.dashboard.upcoming",
      slot: DashboardSlot,
      metadata: { priority: 20 },
      load: () =>
        import("./components/DashboardUpcomingMaintenances").then((m) => ({
          default:
            m.DashboardUpcomingMaintenances as React.ComponentType<unknown>,
        })),
    },
  ],
});
