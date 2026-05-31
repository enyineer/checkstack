import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the script-packages admin UI (Settings -> Script
 * Packages).
 */
export const scriptPackagesRoutes = createRoutes("script-packages", {
  /** Admin settings page: allowlist, registry, storage, sync status. */
  settings: "/",
});
