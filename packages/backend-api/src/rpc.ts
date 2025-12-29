import { os as baseOs } from "@orpc/server";
import { HealthCheckRegistry } from "./health-check";
import { QueuePluginRegistry, QueueFactory } from "@checkmate/queue-api";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger, Fetch, AuthService, AuthUser } from "./types";

export interface RpcContext {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  fetch: Fetch;
  auth: AuthService;
  user?: AuthUser;
  healthCheckRegistry: HealthCheckRegistry;
  queuePluginRegistry: QueuePluginRegistry;
  queueFactory: QueueFactory;
}

/**
 * The core oRPC server instance for the entire backend.
 * We use $context to define the required initial context for all procedures.
 */
export const os = baseOs.$context<RpcContext>();

/**
 * Middleware that ensures the user is authenticated.
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

/**
 * Base procedure for authenticated requests.
 */
export const authedProcedure = os.use(authMiddleware);

/**
 * Middleware that checks for a specific permission.
 */
export const permissionMiddleware = (permission: string | string[]) =>
  os.middleware(async ({ next, context }) => {
    if (!context.user) {
      throw new Error("Unauthorized");
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
 * Service interface for the RPC registry.
 */
export interface RpcService {
  /**
   * Registers an oRPC router for a specific plugin.
   */
  registerRouter(pluginId: string, router: unknown): void;

  /**
   * Registers a raw HTTP handler for a specific subpath.
   * This is useful for third-party libraries that provide their own handlers (e.g. Better Auth).
   */
  registerHttpHandler(
    path: string,
    handler: (req: Request) => Promise<Response>
  ): void;
}

export { z as zod } from "zod";
export * from "./contract";
