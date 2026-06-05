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
      accessRule: satelliteAccess.satellite.read,
      nav: { group: "Reliability", icon: Satellite },
    },
  ],
  apis: [],
  extensions: [],
});
