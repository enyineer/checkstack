import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the Secrets admin UI (Settings → Secrets).
 */
export const secretsRoutes = createRoutes("secrets", {
  home: "/",
});
