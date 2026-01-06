import { createRoutes } from "@checkmate-monitor/common";

/**
 * Route definitions for the healthcheck plugin.
 */
export const healthcheckRoutes = createRoutes("healthcheck", {
  config: "/config",
  history: "/history",
  historyDetail: "/history/:systemId/:configurationId",
});
