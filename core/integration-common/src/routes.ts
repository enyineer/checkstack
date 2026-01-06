import { createRoutes } from "@checkmate-monitor/common";

/**
 * Route definitions for the integration plugin.
 */
export const integrationRoutes = createRoutes("integration", {
  /** Main integrations management page */
  list: "/",
  /** Delivery logs page */
  logs: "/logs",
  /** Subscription detail/edit */
  detail: "/:id",
});
