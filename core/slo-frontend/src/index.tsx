import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { Target, Settings } from "lucide-react";
import { sloRoutes, pluginMetadata, sloAccess } from "@checkstack/slo-common";
import { SystemSloPanel } from "./components/SystemSloPanel";
import { SystemSloBadge } from "./components/SystemSloBadge";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemSignalsSlot,
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
      nav: {
        group: "Reliability",
        icon: Target,
      },
    },
    {
      route: sloRoutes.routes.config,
      load: () =>
        import("./pages/SloConfigPage").then((m) => ({
          default: m.SloConfigPage,
        })),
      title: "SLO Management",
      accessRule: sloAccess.slo.manage,
      nav: {
        group: "Reliability",
        icon: Settings,
      },
    },
    {
      route: sloRoutes.routes.detail,
      load: () =>
        import("./pages/SloDetailPage").then((m) => ({
          default: m.SloDetailPage,
        })),
      title: "SLO Detail",
      // Read-gated; anonymous holds this by default (isPublic), admin-revocable.
      accessRule: sloAccess.slo.read,
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "slo.system-state-badge",
      component: SystemSloBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "slo.system-details-top.panel",
      component: SystemSloPanel,
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "slo.dashboard.signals",
      load: () =>
        import("./components/SloSignalsFiller").then((m) => ({
          default: m.SloSignalsFiller,
        })),
    }),
  ],
});
