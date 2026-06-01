import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  incidentRoutes,
  pluginMetadata,
  incidentAccess,
} from "@checkstack/incident-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import { lazy } from "react";
import { SystemIncidentPanel } from "./components/SystemIncidentPanel";
import { SystemIncidentBadge } from "./components/SystemIncidentBadge";
import { IncidentMenuItems } from "./components/IncidentMenuItems";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const IncidentConfigPage = lazy(() =>
  import("./pages/IncidentConfigPage").then((m) => ({
    default: m.IncidentConfigPage,
  })),
);
const IncidentDetailPage = lazy(() =>
  import("./pages/IncidentDetailPage").then((m) => ({
    default: m.IncidentDetailPage,
  })),
);
const SystemIncidentHistoryPage = lazy(() =>
  import("./pages/SystemIncidentHistoryPage").then((m) => ({
    default: m.SystemIncidentHistoryPage,
  })),
);

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: incidentRoutes.routes.config,
      element: <IncidentConfigPage />,
      title: "Incidents",
      accessRule: incidentAccess.incident.manage,
    },
    {
      route: incidentRoutes.routes.detail,
      element: <IncidentDetailPage />,
      title: "Incident Details",
    },
    {
      route: incidentRoutes.routes.systemHistory,
      element: <SystemIncidentHistoryPage />,
      title: "System Incident History",
    },
  ],
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "incident.user-menu.items",
      component: IncidentMenuItems,
      metadata: { group: "Reliability" },
    }),
    createSlotExtension(SystemStateBadgesSlot, {
      id: "incident.system-incident-badge",
      component: SystemIncidentBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "incident.system-details-top.panel",
      component: SystemIncidentPanel,
    }),
  ],
});
