import { createRoutes } from "@checkmate-monitor/common";

/**
 * Route definitions for the integration plugin.
 */
export const integrationRoutes = createRoutes("integration", {
  /** Main integrations management page */
  list: "/",
  /** Delivery logs page (all logs) */
  logs: "/logs",
  /** Delivery logs filtered by subscription */
  deliveryLogs: "/logs/:subscriptionId",
  /** Provider connections management */
  connections: "/connections/:providerId",
});
