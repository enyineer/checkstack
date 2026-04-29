import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the infrastructure plugin.
 */
export const infrastructureRoutes = createRoutes("infrastructure", {
  config: "/config",
});
