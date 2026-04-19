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
import { SatelliteListPage } from "./pages/SatelliteListPage";
import { SatelliteMenuItems } from "./components/SatelliteMenuItems";

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
    }),
  ],
});
