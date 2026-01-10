import { os as baseOs, ORPCError, Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import { ProcedureMetadata, qualifyPermissionId } from "@checkstack/common";
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
  async ({ next, context, procedure }) => {
    const meta = procedure["~orpc"]?.meta as ProcedureMetadata | undefined;
    const requiredUserType = meta?.userType || "authenticated";
    const contractPermissions = meta?.permissions || [];

    // Prefix contract permissions with pluginId to get fully-qualified permission IDs
    // Contract defines: "catalog.read" -> Stored in DB as: "catalog.catalog.read"
    const requiredPermissions = contractPermissions.map((p: string) =>
      qualifyPermissionId(context.pluginMetadata, { id: p })
    );

    // Helper to wrap next() with error logging
    const nextWithErrorLogging = async () => {
      try {
        return await next({});
      } catch (error) {
        // Log the full error before oRPC sanitizes it to a generic 500
        if (error instanceof ORPCError) {
          // ORPCError is intentional - log at debug level
          context.logger.debug("RPC error response:", {
            code: error.code,
            message: error.message,
            data: error.data,
          });
        } else {
          // Unexpected error - log at error level with full stack trace
          context.logger.error("Unexpected RPC error:", error);
        }
        throw error;
      }
    };

    // 1. Handle anonymous endpoints - no auth required, no permission checks
    if (requiredUserType === "anonymous") {
      return nextWithErrorLogging();
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
      return nextWithErrorLogging();
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

    // Pass through - services are trusted with all permissions
    return nextWithErrorLogging();
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
