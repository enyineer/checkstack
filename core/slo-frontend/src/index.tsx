import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { sloRoutes, pluginMetadata, sloAccess } from "@checkstack/slo-common";
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
      load: () =>
        import("./pages/SloOverviewPage").then((m) => ({
          default: m.SloOverviewPage,
        })),
      title: "SLO Dashboard",
    },
    {
      route: sloRoutes.routes.config,
      load: () =>
        import("./pages/SloConfigPage").then((m) => ({
          default: m.SloConfigPage,
        })),
      title: "SLO Management",
      accessRule: sloAccess.slo.manage,
    },
    {
      route: sloRoutes.routes.detail,
      load: () =>
        import("./pages/SloDetailPage").then((m) => ({
          default: m.SloDetailPage,
        })),
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
