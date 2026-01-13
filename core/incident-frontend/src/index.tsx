import {
  createFrontendPlugin,
  createSlotExtension,
  rpcApiRef,
  type ApiRef,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { incidentApiRef, type IncidentApiClient } from "./api";
import {
  incidentRoutes,
  IncidentApi,
  pluginMetadata,
  incidentAccess,
} from "@checkstack/incident-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";
import { IncidentConfigPage } from "./pages/IncidentConfigPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { SystemIncidentHistoryPage } from "./pages/SystemIncidentHistoryPage";
import { SystemIncidentPanel } from "./components/SystemIncidentPanel";
import { SystemIncidentBadge } from "./components/SystemIncidentBadge";
import { IncidentMenuItems } from "./components/IncidentMenuItems";

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
  apis: [
    {
      ref: incidentApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): IncidentApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin(IncidentApi);
      },
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "incident.user-menu.items",
      component: IncidentMenuItems,
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
