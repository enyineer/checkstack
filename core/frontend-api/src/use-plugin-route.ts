import { useCallback } from "react";
import type { RouteDefinition } from "@checkmate/common";
import { resolveRoute } from "@checkmate/common";
import { pluginRegistry } from "./plugin-registry";

/**
 * React hook for resolving plugin routes to full paths.
 *
 * Can resolve routes in two ways:
 * 1. Using a RouteDefinition object from a plugin's routes (type-safe, recommended)
 * 2. Using a route ID string (for cross-plugin resolution)
 *
 * @example Using RouteDefinition (recommended)
 * ```tsx
 * import { maintenanceRoutes } from "@checkmate/maintenance-common";
 *
 * const MyComponent = () => {
 *   const getRoute = usePluginRoute();
 *
 *   return (
 *     <Link to={getRoute(maintenanceRoutes.routes.config)}>Config</Link>
 *   );
 * };
 * ```
 *
 * @example With path parameters
 * ```tsx
 * const getRoute = usePluginRoute();
 *
 * // For a route like "/detail/:id"
 * const detailPath = getRoute(maintenanceRoutes.routes.detail, { id: "123" });
 * // Returns: "/maintenance/detail/123"
 * ```
 *
 * @example Using route ID string (cross-plugin)
 * ```tsx
 * const path = getRoute("maintenance.config");
 * ```
 */
export function usePluginRoute(): {
  <TParams extends string>(
    route: RouteDefinition<TParams>,
    params?: TParams extends never ? never : Record<TParams, string>
  ): string;
  (routeId: string, params?: Record<string, string>): string | undefined;
} {
  return useCallback(
    (
      routeOrId: RouteDefinition | string,
      params?: Record<string, string>
    ): string | undefined => {
      if (typeof routeOrId === "string") {
        // Resolve by route ID through registry
        return pluginRegistry.resolveRoute(routeOrId, params);
      }
      // Resolve using route definition directly
      // Cast needed because overload signatures hide implementation details
      if (params) {
        return resolveRoute(routeOrId as RouteDefinition<string>, params);
      }
      return resolveRoute(routeOrId as RouteDefinition<never>);
    },
    []
  ) as ReturnType<typeof usePluginRoute>;
}
