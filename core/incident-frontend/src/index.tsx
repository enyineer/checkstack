import {
  createFrontendPlugin,
  createSlotExtension,
  NavbarRightSlot,
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
import { IncidentMentionRegistrar } from "./components/IncidentMentionRegistrar";
import { registerIncidentMentions } from "./utils/mentions";
import { SystemIncidentBadge } from "./components/SystemIncidentBadge";

// Registered at MODULE scope so every already-written incident mention
// resolves as soon as this plugin loads - before, and independently of,
// anything React renders. The search half installs later (see the registrar).
registerIncidentMentions();

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
    // Mounted on the app-level navbar slot, NOT a per-row slot: this is a
    // headless singleton that issues one query, and a per-row slot would mount
    // (and query) once per visible system.
    createSlotExtension(NavbarRightSlot, {
      id: "incident.mention-registrar",
      component: IncidentMentionRegistrar,
    }),
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
