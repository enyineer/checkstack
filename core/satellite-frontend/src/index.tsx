import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  satelliteRoutes,
  pluginMetadata,
  satelliteAccess,
} from "@checkstack/satellite-common";
import { lazy } from "react";
import { SatelliteMenuItems } from "./components/SatelliteMenuItems";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const SatelliteListPage = lazy(() =>
  import("./pages/SatelliteListPage").then((m) => ({
    default: m.SatelliteListPage,
  })),
);

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: satelliteRoutes.routes.list,
      element: <SatelliteListPage />,
      title: "Satellites",
      accessRule: satelliteAccess.satellite.read,
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "satellite.user-menu.items",
      component: SatelliteMenuItems,
      metadata: { group: "Reliability" },
    }),
  ],
});
