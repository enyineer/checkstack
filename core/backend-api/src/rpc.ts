import { os as baseOs, ORPCError, Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import { HealthCheckRegistry } from "./health-check";
import { QueuePluginRegistry, QueueManager } from "@checkmate/queue-api";
import { ProcedureMetadata } from "@checkmate/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  Logger,
  Fetch,
  AuthService,
  AuthUser,
  RealUser,
  ServiceUser,
} from "./types";
import type { Hook } from "./hooks";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Function type for emitting hooks from request handlers.
 */
export type EmitHookFn = <T>(hook: Hook<T>, payload: T) => Promise<void>;

export interface RpcContext {
  /** The plugin ID this request is being handled by (extracted from URL path) */
  pluginId: string;
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  fetch: Fetch;
  auth: AuthService;
  user?: AuthUser;
  healthCheckRegistry: HealthCheckRegistry;
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
export type { ProcedureMetadata } from "@checkmate/common";

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
  async ({ next, context, procedure }) => {
    const meta = procedure["~orpc"]?.meta as ProcedureMetadata | undefined;
    const requiredUserType = meta?.userType || "authenticated";
    const contractPermissions = meta?.permissions || [];

    // Prefix contract permissions with pluginId to get fully-qualified permission IDs
    // Contract defines: "catalog.read" -> Stored in DB as: "catalog-backend.catalog.read"
    const requiredPermissions = contractPermissions.map(
      (p: string) => `${context.pluginId}.${p}`
    );

    // 1. Handle anonymous endpoints - no auth required, no permission checks
    if (requiredUserType === "anonymous") {
      return next({});
    }

    // 2. Handle public endpoints - anyone can attempt, but permissions are checked
    if (requiredUserType === "public") {
      if (context.user) {
        // Authenticated user - check their permissions
        if (context.user.type === "user" && requiredPermissions.length > 0) {
          const userPermissions = context.user.permissions || [];
          const hasPermission = requiredPermissions.some((p: string) => {
            return userPermissions.includes("*") || userPermissions.includes(p);
          });

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
          const hasPermission = requiredPermissions.some((p: string) => {
            return anonymousPermissions.includes(p);
          });

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

    // 5. Enforce permissions (only for real users)
    if (user.type === "user" && requiredPermissions.length > 0) {
      const userPermissions = user.permissions || [];
      const hasPermission = requiredPermissions.some((p: string) => {
        return userPermissions.includes("*") || userPermissions.includes(p);
      });

      if (!hasPermission) {
        throw new ORPCError("FORBIDDEN", {
          message: `Missing permission: ${requiredPermissions.join(" or ")}`,
        });
      }
    }

    // Pass through - services are trusted with all permissions
    return next({});
  }
);

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
 * import { baseContractBuilder } from "@checkmate/backend-api";
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
 *     .meta({ userType: "both" })
 *     .output(z.object({ info: z.string() })),
 * };
 */
export const baseContractBuilder = os.use(autoAuthMiddleware).meta({});

// =============================================================================
// LEGACY MIDDLEWARE (for non-contract-based routers)
// =============================================================================

/**
 * Simple auth middleware - just checks user is authenticated.
 * @deprecated Use contract-based approach with autoAuthMiddleware instead.
 */
export const authMiddleware = os.middleware(async ({ next, context }) => {
  if (!context.user) {
    throw new Error("Unauthorized");
  }
  return next({
    context: {
      user: context.user,
    },
  });
});

/** @deprecated Use contract-based approach with meta.userType: "both" */
export const authedProcedure = os.use(authMiddleware);

/** @deprecated Alias for authedProcedure */
export const authenticated = authedProcedure;

/**
 * Middleware for service-only endpoints.
 * @deprecated Use contract-based approach with meta.userType: "service"
 */
export const serviceOnlyMiddleware = os.middleware(
  async ({ next, context }) => {
    if (!context.user) {
      throw new Error("Unauthorized");
    }
    if (context.user.type !== "service") {
      throw new Error(
        "Forbidden: This endpoint is for service-to-service calls only"
      );
    }
    return next({ context: { user: context.user } });
  }
);

/** @deprecated Use contract-based approach with meta.userType: "service" */
export const serviceProcedure = os.use(serviceOnlyMiddleware);

/**
 * Middleware for user-only endpoints.
 * @deprecated Use contract-based approach with meta.userType: "user"
 */
export const userOnlyMiddleware = os.middleware(async ({ next, context }) => {
  if (!context.user) {
    throw new Error("Unauthorized");
  }
  if (context.user.type !== "user") {
    throw new Error("Forbidden: This endpoint is for user access only");
  }
  return next({ context: { user: context.user } });
});

/** @deprecated Use contract-based approach with meta.userType: "user" */
export const userProcedure = os.use(userOnlyMiddleware);

/**
 * Permission middleware factory.
 * @deprecated Use contract-based approach with meta.permissions
 */
export const permissionMiddleware = (permission: string | string[]) =>
  os.middleware(async ({ next, context }) => {
    if (!context.user) {
      throw new Error("Unauthorized");
    }

    if (context.user.type === "service") {
      return next({});
    }

    const userPermissions = context.user.permissions || [];
    const perms = Array.isArray(permission) ? permission : [permission];

    const hasPermission = perms.some((p) => {
      return userPermissions.includes("*") || userPermissions.includes(p);
    });

    if (!hasPermission) {
      throw new Error(`Forbidden: Missing ${perms.join(" or ")}`);
    }

    return next({});
  });

/**
 * @deprecated Use contract-based approach
 */
export const withPermissions = (permissions: string | string[]) =>
  authenticated.use(permissionMiddleware(permissions));

/**
 * @deprecated Use autoAuthMiddleware
 */
export const autoPermissionMiddleware = autoAuthMiddleware;

// Backward compatibility alias
export type PermissionMetadata = ProcedureMetadata;

// =============================================================================
// RPC SERVICE INTERFACE
// =============================================================================

/**
 * Service interface for the RPC registry.
 */
export interface RpcService {
  /**
   * Registers an oRPC router for this plugin.
   * Routes are automatically prefixed with /api/{pluginName}/
   * @param router - The oRPC router instance
   * @param subpath - Optional subpath (defaults to "/")
   */
  registerRouter<C extends AnyContractRouter>(
    router: Router<C, RpcContext>,
    subpath?: string
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
