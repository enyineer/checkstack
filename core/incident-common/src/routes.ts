import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the incident plugin.
 * Import and use these routes in both frontend plugins and for link generation.
 *
 * @example Frontend plugin usage
 * ```tsx
 * import { incidentRoutes } from "@checkstack/incident-common";
 *
 * createFrontendPlugin({
 *   routes: [
 *     { route: incidentRoutes.routes.config, element: <ConfigPage /> },
 *   ],
 * });
 * ```
 *
 * @example Link generation
 * ```tsx
 * import { incidentRoutes } from "@checkstack/incident-common";
 * import { resolveRoute } from "@checkstack/common";
 *
 * const detailPath = resolveRoute(incidentRoutes.routes.detail, { incidentId });
 * ```
 */
export const incidentRoutes = createRoutes("incident", {
  // Public, read-gated overview of incidents. Anonymous holds `incident.read`
  // by default, so this is reachable logged-out (unlike `config`, which is
  // manage-gated). Registered as nav so the sidebar shows it to everyone.
  overview: "/",
  config: "/config",
  detail: "/:incidentId",
  systemHistory: "/system/:systemId/incidents",
});
