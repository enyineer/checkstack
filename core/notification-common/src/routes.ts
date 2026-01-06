import { createRoutes } from "@checkmate-monitor/common";

/**
 * Route definitions for the notification plugin.
 */
export const notificationRoutes = createRoutes("notification", {
  home: "/",
  settings: "/settings",
});
