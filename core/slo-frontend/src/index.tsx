import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { sloRoutes, pluginMetadata, sloAccess } from "@checkstack/slo-common";
import { SloOverviewPage } from "./pages/SloOverviewPage";
import { SloConfigPage } from "./pages/SloConfigPage";
import { SloDetailPage } from "./pages/SloDetailPage";
import { SystemSloPanel } from "./components/SystemSloPanel";
import { SystemSloBadge } from "./components/SystemSloBadge";
import { SloMenuItems } from "./components/SloMenuItems";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: sloRoutes.routes.overview,
      element: <SloOverviewPage />,
      title: "SLO Dashboard",
    },
    {
      route: sloRoutes.routes.config,
      element: <SloConfigPage />,
      title: "SLO Management",
      accessRule: sloAccess.slo.manage,
    },
    {
      route: sloRoutes.routes.detail,
      element: <SloDetailPage />,
      title: "SLO Detail",
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "slo.user-menu.items",
      component: SloMenuItems,
    }),
    createSlotExtension(SystemStateBadgesSlot, {
      id: "slo.system-state-badge",
      component: SystemSloBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "slo.system-details-top.panel",
      component: SystemSloPanel,
    }),
  ],
});
