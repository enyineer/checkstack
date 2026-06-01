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
import { SatelliteMenuItems } from "./components/SatelliteMenuItems";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: satelliteRoutes.routes.list,
      load: () =>
        import("./pages/SatelliteListPage").then((m) => ({
          default: m.SatelliteListPage,
        })),
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
