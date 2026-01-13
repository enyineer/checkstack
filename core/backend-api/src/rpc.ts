import { os as baseOs, ORPCError, Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import {
  ProcedureMetadata,
  qualifyPermissionId,
  qualifyResourceType,
} from "@checkstack/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  Logger,
  Fetch,
  AuthService,
  AuthUser,
  RealUser,
  ServiceUser,
} from "./types";
import type { PluginMetadata } from "@checkstack/common";
import type { Hook } from "./hooks";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Function type for emitting hooks from request handlers.
 */
export type EmitHookFn = <T>(hook: Hook<T>, payload: T) => Promise<void>;

export interface RpcContext {
  /**
   * The plugin metadata for this request.
   * Use this to access pluginId and other plugin configuration.
   */
  pluginMetadata: PluginMetadata;

  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  fetch: Fetch;
  auth: AuthService;
  user?: AuthUser;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  queuePluginRegistry: QueuePluginRegistry;
  queueManager: QueueManager;
  /** Emit a hook event for cross-plugin communication */
  emitHook: EmitHookFn;
}

/** Context with authenticated real user */
export interface UserRpcContext extends RpcContext {
  user: RealUser;
}

/** Context with authenticated service */
export interface ServiceRpcContext extends RpcContext {
  user: ServiceUser;
}

/**
 * The core oRPC server instance for the entire backend.
 * We use $context to define the required initial context for all procedures.
 */
export const os = baseOs.$context<RpcContext>();

// Re-export ProcedureMetadata from common for convenience
export type { ProcedureMetadata } from "@checkstack/common";

// =============================================================================
// UNIFIED AUTH MIDDLEWARE
// =============================================================================

/**
 * Unified authentication and authorization middleware.
 *
 * Automatically enforces based on contract metadata:
 * 1. User type (from meta.userType):
 *    - "anonymous": No authentication required, no permission checks
 *    - "public": Anyone can attempt, but permissions are checked (anonymous role for guests)
 *    - "user": Only real users (frontend authenticated)
 *    - "service": Only services (backend-to-backend)
 *    - "authenticated": Either users or services, but must be authenticated (default)
 * 2. Permissions (from meta.permissions, only for real users or public anonymous)
 *
 * Use this in backend routers: `implement(contract).$context<RpcContext>().use(autoAuthMiddleware)`
 */
export const autoAuthMiddleware = os.middleware(
  async ({ next, context, procedure }, input: unknown) => {
    const meta = procedure["~orpc"]?.meta as ProcedureMetadata | undefined;
    const requiredUserType = meta?.userType || "authenticated";
    const contractPermissions = meta?.permissions || [];
    const resourceAccessConfigs = meta?.resourceAccess || [];

    // Prefix contract permissions with pluginId to get fully-qualified permission IDs
    // Contract defines: "catalog.read" -> Stored in DB as: "catalog.catalog.read"
    const requiredPermissions = contractPermissions.map((p: string) =>
      qualifyPermissionId(context.pluginMetadata, { id: p })
    );

    // 1. Handle anonymous endpoints - no auth required, no permission checks
    if (requiredUserType === "anonymous") {
      return next({});
    }

    // 2. Handle public endpoints - anyone can attempt, but permissions are checked
    if (requiredUserType === "public") {
      if (context.user) {
        // Authenticated user or application - check their permissions
        if (
          (context.user.type === "user" ||
            context.user.type === "application") &&
          requiredPermissions.length > 0
        ) {
          const userPermissions = context.user.permissions || [];
          const hasPermission = requiredPermissions.some(
            (p: string) =>
              userPermissions.includes("*") || userPermissions.includes(p)
          );

          if (!hasPermission) {
            throw new ORPCError("FORBIDDEN", {
              message: `Missing permission: ${requiredPermissions.join(
                " or "
              )}`,
            });
          }
        }
        // Services are trusted with all permissions
      } else {
        // Anonymous user - check anonymous role permissions
        if (requiredPermissions.length > 0) {
          const anonymousPermissions =
            await context.auth.getAnonymousPermissions();
          const hasPermission = requiredPermissions.some((p: string) =>
            anonymousPermissions.includes(p)
          );

          if (!hasPermission) {
            throw new ORPCError("FORBIDDEN", {
              message: `Anonymous access not permitted for this resource`,
            });
          }
        }
      }
      return next({});
    }

    // 3. Enforce authentication for user/service/authenticated types
    if (!context.user) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authentication required",
      });
    }

    const user = context.user;

    // 4. Enforce user type
    if (requiredUserType === "user" && user.type !== "user") {
      throw new ORPCError("FORBIDDEN", {
        message: "This endpoint is for users only",
      });
    }
    if (requiredUserType === "service" && user.type !== "service") {
      throw new ORPCError("FORBIDDEN", {
        message: "This endpoint is for services only",
      });
    }

    // 5. Enforce permissions (for real users and applications)
    if (
      (user.type === "user" || user.type === "application") &&
      requiredPermissions.length > 0
    ) {
      const userPermissions = user.permissions || [];
      const hasPermission = requiredPermissions.some(
        (p: string) =>
          userPermissions.includes("*") || userPermissions.includes(p)
      );

      if (!hasPermission) {
        throw new ORPCError("FORBIDDEN", {
          message: `Missing permission: ${requiredPermissions.join(" or ")}`,
        });
      }
    }

    // 6. Resource-level access control
    // Skip if no resource access configs or if user is a service
    if (resourceAccessConfigs.length === 0 || user.type === "service") {
      return next({});
    }

    const userId = user.id;
    const userType = user.type;
    const action = inferActionFromPermissions(contractPermissions);
    const hasGlobalPermission =
      user.permissions?.includes("*") ||
      contractPermissions.some((p) =>
        user.permissions?.includes(
          qualifyPermissionId(context.pluginMetadata, { id: p })
        )
      );

    // Separate single vs list configs
    const singleConfigs = resourceAccessConfigs.filter(
      (c) => c.filterMode !== "list"
    );
    const listConfigs = resourceAccessConfigs.filter(
      (c) => c.filterMode === "list"
    );

    // Pre-check: Single resource access
    for (const config of singleConfigs) {
      if (!config.idParam) continue;
      const resourceId = getNestedValue(input, config.idParam);
      if (!resourceId) continue;

      const qualifiedType = qualifyResourceType(
        context.pluginMetadata.pluginId,
        config.resourceType
      );

      const hasAccess = await checkResourceAccessViaS2S({
        auth: context.auth,
        userId,
        userType,
        resourceType: qualifiedType,
        resourceId,
        action,
        hasGlobalPermission,
      });

      if (!hasAccess) {
        throw new ORPCError("FORBIDDEN", {
          message: `Access denied to resource ${config.resourceType}:${resourceId}`,
        });
      }
    }

    // Execute handler
    const result = await next({});

    // Post-filter: List endpoints
    if (
      listConfigs.length > 0 &&
      result.output &&
      typeof result.output === "object"
    ) {
      const mutableOutput = result.output as Record<string, unknown>;

      for (const config of listConfigs) {
        if (!config.outputKey) {
          context.logger.error(
            `resourceAccess: filterMode "list" requires outputKey`
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid resource access configuration",
          });
        }

        const items = mutableOutput[config.outputKey];

        if (items === undefined) {
          context.logger.error(
            `resourceAccess: expected "${config.outputKey}" in response but not found`
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        if (!Array.isArray(items)) {
          context.logger.error(
            `resourceAccess: "${config.outputKey}" must be an array`
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        const qualifiedType = qualifyResourceType(
          context.pluginMetadata.pluginId,
          config.resourceType
        );

        const resourceIds = items
          .map((item) => (item as { id?: string }).id)
          .filter((id): id is string => typeof id === "string");

        const accessibleIds = await getAccessibleResourceIdsViaS2S({
          auth: context.auth,
          userId,
          userType,
          resourceType: qualifiedType,
          resourceIds,
          action,
          hasGlobalPermission,
        });

        const accessibleSet = new Set(accessibleIds);
        mutableOutput[config.outputKey] = items.filter((item) => {
          const id = (item as { id?: string }).id;
          return id && accessibleSet.has(id);
        });
      }
    }

    return result;
  }
);

/**
 * Extract a nested value from an object using dot notation.
 * E.g., getNestedValue({ params: { id: "123" } }, "params.id") => "123"
 */
function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Determine action from permission suffix (read vs manage).
 */
function inferActionFromPermissions(permissions: string[]): "read" | "manage" {
  const perm = permissions[0] || "";
  if (perm.endsWith(".manage") || perm.endsWith("Manage")) return "manage";
  return "read";
}

/**
 * Check resource access via auth service S2S endpoint.
 */
async function checkResourceAccessViaS2S({
  auth,
  userId,
  userType,
  resourceType,
  resourceId,
  action,
  hasGlobalPermission,
}: {
  auth: AuthService;
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceId: string;
  action: "read" | "manage";
  hasGlobalPermission: boolean;
}): Promise<boolean> {
  try {
    const result = await auth.checkResourceTeamAccess({
      userId,
      userType,
      resourceType,
      resourceId,
      action,
      hasGlobalPermission,
    });
    return result.hasAccess;
  } catch {
    // If team access check fails (e.g., service not available), fall back to global permission
    return hasGlobalPermission;
  }
}

/**
 * Get accessible resource IDs via auth service S2S endpoint.
 */
async function getAccessibleResourceIdsViaS2S({
  auth,
  userId,
  userType,
  resourceType,
  resourceIds,
  action,
  hasGlobalPermission,
}: {
  auth: AuthService;
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceIds: string[];
  action: "read" | "manage";
  hasGlobalPermission: boolean;
}): Promise<string[]> {
  if (resourceIds.length === 0) return [];

  try {
    return await auth.getAccessibleResourceIds({
      userId,
      userType,
      resourceType,
      resourceIds,
      action,
      hasGlobalPermission,
    });
  } catch {
    // If team access check fails, fall back to global permission behavior
    return hasGlobalPermission ? resourceIds : [];
  }
}

// =============================================================================
// CONTRACT BUILDER
// =============================================================================

/**
 * Base contract builder with automatic authentication and authorization.
 *
 * All plugin contracts should use this builder. It ensures that:
 * 1. All procedures are authenticated by default
 * 2. User type is enforced based on meta.userType
 * 3. Permissions are enforced based on meta.permissions
 *
 * @example
 * import { baseContractBuilder } from "@checkstack/backend-api";
 * import { permissions } from "./permissions";
 *
 * const myContract = {
 *   // User-only endpoint with specific permission
 *   getItems: baseContractBuilder
 *     .meta({ userType: "user", permissions: [permissions.myPluginRead.id] })
 *     .output(z.array(ItemSchema)),
 *
 *   // Service-only endpoint (backend-to-backend)
 *   internalSync: baseContractBuilder
 *     .meta({ userType: "service" })
 *     .input(z.object({ data: z.string() }))
 *     .output(z.object({ success: z.boolean() })),
 *
 *   // Public authenticated endpoint (both users and services)
 *   getPublicInfo: baseContractBuilder
 *     .meta({ userType: "authenticated" })
 *     .output(z.object({ info: z.string() })),
 * };
 */
export const baseContractBuilder = os.use(autoAuthMiddleware).meta({});

// =============================================================================
// RPC SERVICE INTERFACE
// =============================================================================

/**
 * Service interface for the RPC registry.
 */
export interface RpcService {
  /**
   * Registers an oRPC router and its contract for this plugin.
   * Routes are automatically prefixed with /api/{pluginName}/
   * The contract is used for OpenAPI generation.
   * @param router - The oRPC router instance
   * @param contract - The oRPC contract definition (from *-common package)
   */
  registerRouter<C extends AnyContractRouter>(
    router: Router<C, RpcContext>,
    contract: C
  ): void;

  /**
   * Registers a raw HTTP handler for this plugin.
   * Routes are automatically prefixed with /api/{pluginName}/
   * This is useful for third-party libraries that provide their own handlers (e.g. Better Auth).
   * @param handler - The HTTP request handler
   * @param path - Optional path within plugin namespace (defaults to "/")
   */
  registerHttpHandler(
    handler: (req: Request) => Promise<Response>,
    path?: string
  ): void;
}

export { z as zod } from "zod";
export * from "./contract";
