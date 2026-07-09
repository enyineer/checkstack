import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import {
  incidentRoutes,
  pluginMetadata,
  incidentAccess,
  incidentResourceTypes,
} from "@checkstack/incident-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemSignalsSlot,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { AlertTriangle } from "lucide-react";
import { SystemIncidentPanel } from "./components/SystemIncidentPanel";
import { SystemIncidentBadge } from "./components/SystemIncidentBadge";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      // Public, read-gated overview. Anonymous holds `incident.read` by default,
      // so this nav shows logged-out (Item 6). Managing/editing stays on the
      // separate manage-gated config route below.
      route: incidentRoutes.routes.overview,
      load: () =>
        import("./pages/IncidentOverviewPage").then((m) => ({
          default: m.IncidentOverviewPage,
        })),
      title: "Incidents",
      accessRule: incidentAccess.incident.read,
      nav: {
        group: "Reliability",
        icon: AlertTriangle,
        isVisible: () => true,
      },
    },
    {
      route: incidentRoutes.routes.config,
      load: () =>
        import("./pages/IncidentConfigPage").then((m) => ({
          default: m.IncidentConfigPage,
        })),
      title: "Manage Incidents",
      accessRule: incidentAccess.incident.manage,
      // Team-scoped: managing a system unlocks the incidents surface for it.
      manageCapability: {
        objectType: incidentResourceTypes.incident,
        parentType: catalogResourceTypes.system,
      },
      nav: {
        group: "Reliability",
        icon: AlertTriangle,
      },
    },
    {
      route: incidentRoutes.routes.detail,
      load: () =>
        import("./pages/IncidentDetailPage").then((m) => ({
          default: m.IncidentDetailPage,
        })),
      title: "Incident Details",
      // Read-gated; the anonymous role holds this by default (isPublic) but an
      // admin can revoke it, so the route guard always checks the actual grant.
      accessRule: incidentAccess.incident.read,
    },
    {
      route: incidentRoutes.routes.systemHistory,
      load: () =>
        import("./pages/SystemIncidentHistoryPage").then((m) => ({
          default: m.SystemIncidentHistoryPage,
        })),
      title: "System Incident History",
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "incident.system-incident-badge",
      component: SystemIncidentBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "incident.system-details-top.panel",
      component: SystemIncidentPanel,
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "incident.dashboard.signals",
      load: () =>
        import("./components/IncidentSignalsFiller").then((m) => ({
          default: m.IncidentSignalsFiller,
        })),
    }),
  ],
});
