/**
 * Route definition with path and extracted parameters.
 */
export interface RouteDefinition<TParams extends string = string> {
  /** Unique route identifier (pluginId.routeName) */
  id: string;
  /** Plugin identifier */
  pluginId: string;
  /** Relative path with optional :param placeholders */
  path: string;
  /** Parameter names extracted from path */
  params: TParams[];
}

/**
 * Plugin routes configuration object.
 */
export interface PluginRoutes<
  T extends Record<string, RouteDefinition<string>> = Record<
    string,
    RouteDefinition<string>
  >
> {
  pluginId: string;
  routes: T;
}

/**
 * Extract parameter names from a path string.
 * E.g., "/detail/:id" -> ["id"]
 */
type ExtractParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParams<Rest>
    : T extends `${string}:${infer Param}`
    ? Param
    : never;

/**
 * Creates a typed plugin routes configuration.
 * Routes are relative paths that will be prefixed with /{pluginId} at runtime.
 *
 * @param pluginId - Plugin identifier (without -frontend/-backend suffix)
 * @param routes - Object mapping route names to paths
 * @returns Typed routes object for use in frontend plugins and route resolution
 *
 * @example
 * ```typescript
 * // In maintenance-common/src/routes.ts
 * export const maintenanceRoutes = createRoutes("maintenance", {
 *   config: "/config",
 *   detail: "/detail/:id",
 * });
 *
 * // Usage in frontend:
 * routes: [
 *   { route: maintenanceRoutes.routes.config, element: <ConfigPage /> },
 * ]
 *
 * // Resolution:
 * resolveRoute(maintenanceRoutes.routes.config)           // "/maintenance/config"
 * resolveRoute(maintenanceRoutes.routes.detail, { id: "123" }) // "/maintenance/detail/123"
 * ```
 */
export function createRoutes<T extends Record<string, string>>(
  pluginId: string,
  routes: T
): PluginRoutes<{
  [K in keyof T]: RouteDefinition<ExtractParams<T[K]>>;
}> {
  const routeDefinitions: Record<string, RouteDefinition<string>> = {};

  for (const [name, path] of Object.entries(routes)) {
    // Extract params from path (e.g., ":id" -> "id")
    const params: string[] = [];
    const paramMatches = path.matchAll(/:([^/]+)/g);
    for (const match of paramMatches) {
      params.push(match[1]);
    }

    routeDefinitions[name] = {
      id: `${pluginId}.${name}`,
      pluginId,
      path,
      params,
    };
  }

  return {
    pluginId,
    routes: routeDefinitions,
  } as PluginRoutes<{
    [K in keyof T]: RouteDefinition<ExtractParams<T[K]>>;
  }>;
}

/**
 * Resolves a route definition to a full path with the plugin prefix.
 *
 * @param route - Route definition from a plugin routes object
 * @param params - Path parameters to substitute (required if route has params)
 * @returns The full path with plugin prefix and substituted parameters
 *
 * @example
 * ```typescript
 * resolveRoute(maintenanceRoutes.routes.config)
 * // Returns: "/maintenance/config"
 *
 * resolveRoute(maintenanceRoutes.routes.detail, { id: "123" })
 * // Returns: "/maintenance/detail/123"
 * ```
 */
// Overload: no params needed for routes without path parameters
export function resolveRoute(route: RouteDefinition<never>): string;
// Overload: params required for routes with path parameters
export function resolveRoute<TParams extends string>(
  route: RouteDefinition<TParams>,
  params: Record<TParams, string>
): string;
// Implementation
export function resolveRoute<TParams extends string>(
  route: RouteDefinition<TParams>,
  params?: Record<string, string>
): string {
  const basePath = `/${route.pluginId}${
    route.path.startsWith("/") ? route.path : `/${route.path}`
  }`;

  if (!params || route.params.length === 0) {
    return basePath;
  }

  // Substitute path parameters (e.g., :id -> actual value)
  let result = basePath;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value);
  }
  return result;
}
