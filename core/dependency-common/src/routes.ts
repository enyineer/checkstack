import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the dependency plugin.
 * The Dependency Map page is registered under the Catalog namespace.
 *
 * @example Frontend plugin usage
 * ```tsx
 * import { dependencyRoutes } from "@checkstack/dependency-common";
 *
 * createFrontendPlugin({
 *   routes: [
 *     { route: dependencyRoutes.routes.map, element: <DependencyMapPage /> },
 *   ],
 * });
 * ```
 *
 * @example Link generation
 * ```tsx
 * import { dependencyRoutes } from "@checkstack/dependency-common";
 * import { resolveRoute } from "@checkstack/common";
 *
 * const mapPath = resolveRoute(dependencyRoutes.routes.map);
 * ```
 */
export const dependencyRoutes = createRoutes("dependency", {
  map: "/map",
  systemDependencies: "/system/:systemId",
});
