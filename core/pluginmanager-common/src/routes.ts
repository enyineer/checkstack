import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the plugin manager admin UI.
 *
 * @example
 * ```tsx
 * import { pluginManagerRoutes } from "@checkstack/pluginmanager-common";
 *
 * createFrontendPlugin({
 *   routes: [
 *     { route: pluginManagerRoutes.routes.installed, element: <InstalledPluginsPage /> },
 *   ],
 * });
 * ```
 */
export const pluginManagerRoutes = createRoutes("pluginmanager", {
  installed: "/",
  install: "/install",
  events: "/events",
});
