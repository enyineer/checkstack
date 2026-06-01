import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { sloRoutes, pluginMetadata, sloAccess } from "@checkstack/slo-common";
import { lazy } from "react";
import { SystemSloPanel } from "./components/SystemSloPanel";
import { SystemSloBadge } from "./components/SystemSloBadge";
import { SloMenuItems } from "./components/SloMenuItems";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
} from "@checkstack/catalog-common";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const SloOverviewPage = lazy(() =>
  import("./pages/SloOverviewPage").then((m) => ({
    default: m.SloOverviewPage,
  })),
);
const SloConfigPage = lazy(() =>
  import("./pages/SloConfigPage").then((m) => ({ default: m.SloConfigPage })),
);
const SloDetailPage = lazy(() =>
  import("./pages/SloDetailPage").then((m) => ({ default: m.SloDetailPage })),
);

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
      metadata: { group: "Reliability" },
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
