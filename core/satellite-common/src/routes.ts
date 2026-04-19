import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the satellite plugin.
 * Import and use these routes in both frontend plugins and for link generation.
 *
 * @example Frontend plugin usage
 * ```tsx
 * import { satelliteRoutes } from "@checkstack/satellite-common";
 *
 * createFrontendPlugin({
 *   routes: [
 *     { route: satelliteRoutes.routes.list, element: <SatelliteListPage /> },
 *   ],
 * });
 * ```
 */
export const satelliteRoutes = createRoutes("satellite", {
  list: "/",
});
