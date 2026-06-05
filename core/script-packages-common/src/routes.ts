import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the script-packages admin UI (Settings -> Script
 * Packages).
 */
export const scriptPackagesRoutes = createRoutes("script-packages", {
  /** Admin settings page: allowlist, registry, storage, sync status. */
  settings: "/",
  /**
   * Admin-only global script-sandbox policy editor (resource caps,
   * filesystem, network egress, privilege). Gated by the dedicated
   * `script-sandbox.manage` permission, distinct from `script-packages.manage`.
   */
  sandbox: "/sandbox",
});
