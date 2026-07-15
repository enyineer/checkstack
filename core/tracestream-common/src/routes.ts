import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the tracestream plugin. Use these for type-safe route
 * generation with resolveRoute().
 */
export const tracestreamRoutes = createRoutes("tracestream", {
  home: "/",
  detail: "/:streamId",
});
