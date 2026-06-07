import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  satelliteRoutes,
  pluginMetadata,
  satelliteAccess,
} from "@checkstack/satellite-common";
import { Satellite } from "lucide-react";

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
      // The page is entirely manage-gated (no read-only view), so gate the route
      // AND its sidebar entry on manage - otherwise read-only users see the nav
      // item, click it, and immediately hit "Access Denied".
      accessRule: satelliteAccess.satellite.manage,
      nav: { group: "Reliability", icon: Satellite },
    },
  ],
  apis: [],
  extensions: [],
});
