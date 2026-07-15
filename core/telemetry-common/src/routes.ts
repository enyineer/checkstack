import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the telemetry plugin. Use these for type-safe route
 * generation with resolveRoute().
 */
export const telemetryRoutes = createRoutes("telemetry", {
  /** Global sources management page (all instances, all types). */
  sources: "/sources",
});
