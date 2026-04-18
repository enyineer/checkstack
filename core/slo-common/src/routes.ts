import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the SLO plugin.
 *
 * @example Frontend plugin usage
 * ```tsx
 * import { sloRoutes } from "@checkstack/slo-common";
 *
 * createFrontendPlugin({
 *   routes: [
 *     { route: sloRoutes.routes.overview, element: <SloOverviewPage /> },
 *   ],
 * });
 * ```
 *
 * @example Link generation
 * ```tsx
 * import { sloRoutes } from "@checkstack/slo-common";
 * import { resolveRoute } from "@checkstack/common";
 *
 * const detailPath = resolveRoute(sloRoutes.routes.detail, { sloId });
 * ```
 */
export const sloRoutes = createRoutes("slo", {
  overview: "/",
  config: "/config",
  configDetail: "/config/:sloId",
  detail: "/:sloId",
});
