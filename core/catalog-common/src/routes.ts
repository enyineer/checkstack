import { createRoutes } from "@checkmate-monitor/common";

/**
 * Route definitions for the catalog plugin.
 */
export const catalogRoutes = createRoutes("catalog", {
  home: "/",
  config: "/config",
  systemDetail: "/system/:systemId",
});
