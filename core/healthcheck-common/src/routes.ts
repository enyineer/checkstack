import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the healthcheck plugin.
 */
export const healthcheckRoutes = createRoutes("healthcheck", {
  config: "/config",
  create: "/config/create",
  edit: "/config/:configId/edit",
  assignments: "/assignments/:systemId",
  history: "/history",
  historyDetail: "/history/:systemId/:configurationId",
  historyRun: "/history/:systemId/:configurationId/:runId",
});
