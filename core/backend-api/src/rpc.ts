import { os as baseOs, ORPCError, Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import {
  ProcedureMetadata,
  qualifyAccessRuleId,
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
 *    - "anonymous": No authentication required, no access checks
 *    - "public": Anyone can attempt, access checked based on user type
 *    - "user": Only real users (frontend authenticated)
 *    - "service": Only services (backend-to-backend)
 *    - "authenticated": Either users or services, but must be authenticated (default)
 * 2. Access rules (from meta.access): unified access rules + resource-level access control
 *
 * Access Control Logic:
 * - Rules WITHOUT instanceAccess: require global access
 * - Rules WITH instanceAccess: S2S call to auth-backend decides based on:
 *   - Global access OR team grants (when resource is NOT teamOnly)
 *   - Team grants only (when resource IS teamOnly)
 *
 * Use this in backend routers: `implement(contract).$context<RpcContext>().use(autoAuthMiddleware)`
 */
export const autoAuthMiddleware = os.middleware(
  async ({ next, context, procedure }, input: unknown) => {
    const meta = procedure["~orpc"]?.meta as ProcedureMetadata | undefined;
    const requiredUserType = meta?.userType || "authenticated";
    const accessRules = meta?.access || [];

    // Build qualified access rule IDs for each access rule
    const qualifiedRules = accessRules.map((rule) => ({
      ...rule,
      qualifiedId: qualifyAccessRuleId(context.pluginMetadata, rule),
      qualifiedResourceType: qualifyResourceType(
        context.pluginMetadata.pluginId,
        rule.resource
      ),
    }));

    // Separate rules by type
    const globalOnlyRules = qualifiedRules.filter((r) => !r.instanceAccess);
    const instanceRules = qualifiedRules.filter((r) => r.instanceAccess);
    const singleResourceRules = instanceRules.filter(
      (r) => r.instanceAccess?.idParam
    );
    const listResourceRules = instanceRules.filter(
      (r) => r.instanceAccess?.listKey
    );

    // 1. Handle anonymous endpoints - no auth required, no access checks
    if (requiredUserType === "anonymous") {
      return next({});
    }

    // 2. Handle public endpoints - anyone can attempt
    if (requiredUserType === "public") {
      const user = context.user;

      // Check global-only rules based on user status
      if (globalOnlyRules.length > 0) {
        if (user && (user.type === "user" || user.type === "application")) {
          // Authenticated user - check their global accesss
          const userAccessRules = user.accessRules || [];
          for (const rule of globalOnlyRules) {
            const hasAccess =
              userAccessRules.includes("*") ||
              userAccessRules.includes(rule.qualifiedId);
            if (!hasAccess) {
              throw new ORPCError("FORBIDDEN", {
                message: `Missing access: ${rule.qualifiedId}`,
              });
            }
          }
        } else if (user && user.type === "service") {
          // Services are trusted
        } else {
          // Anonymous - check anonymous role
          const anonymousAccessRules =
            await context.auth.getAnonymousAccessRules();
          for (const rule of globalOnlyRules) {
            if (!anonymousAccessRules.includes(rule.qualifiedId)) {
              throw new ORPCError("FORBIDDEN", {
                message: `Anonymous access not permitted for this resource`,
              });
            }
          }
        }
      }

      // For rules WITH instanceAccess on public endpoints:
      // - If user is authenticated, check via S2S (step 6)
      // - If anonymous, they get empty results from list filtering
      //   (since they have no team grants - S2S will filter everything)

      // If there are no instance rules, we can return early for public endpoints
      if (instanceRules.length === 0) {
        return next({});
      }
      // Otherwise, fall through to step 6 for instance-level checks
    }

    // 3. Enforce authentication for user/service/authenticated types
    if (requiredUserType !== "public" && !context.user) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authentication required",
      });
    }

    const user = context.user;

    // 4. Enforce user type
    if (user) {
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
    }

    // 5. Skip remaining checks for services - they are trusted
    if (user?.type === "service") {
      return next({});
    }

    // 6. Check access rules (for real users, applications, and anonymous on public endpoints)
    const userId = user?.id;
    const userType = user?.type as "user" | "application" | undefined;
    const userAccessRules = user?.accessRules || [];

    // Check global-only rules (for non-public endpoints - public already handled above)
    if (requiredUserType !== "public") {
      for (const rule of globalOnlyRules) {
        const hasAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(rule.qualifiedId);
        if (!hasAccess) {
          throw new ORPCError("FORBIDDEN", {
            message: `Missing access: ${rule.qualifiedId}`,
          });
        }
      }
    }

    // Pre-check: Single resource access rules
    // For these, user MUST have either global access OR team grant
    for (const rule of singleResourceRules) {
      const resourceId = getNestedValue(input, rule.instanceAccess!.idParam!);
      if (!resourceId) continue;

      // If no user (anonymous on public endpoint), deny access to single resources
      // (they can't have team grants)
      if (!userId || !userType) {
        throw new ORPCError("FORBIDDEN", {
          message: `Authentication required to access ${rule.resource}:${resourceId}`,
        });
      }

      const hasGlobalAccess =
        userAccessRules.includes("*") ||
        userAccessRules.includes(rule.qualifiedId);

      const hasAccess = await checkResourceAccessViaS2S({
        auth: context.auth,
        userId,
        userType,
        resourceType: rule.qualifiedResourceType,
        resourceId,
        action: rule.level,
        hasGlobalAccess,
      });

      if (!hasAccess) {
        throw new ORPCError("FORBIDDEN", {
          message: `Access denied to resource ${rule.resource}:${resourceId}`,
        });
      }
    }

    // Execute handler
    const result = await next({});

    // Post-filter: List endpoints
    // For these, return only resources user has access to (via global perm OR team grant)
    if (
      listResourceRules.length > 0 &&
      result.output &&
      typeof result.output === "object"
    ) {
      const mutableOutput = result.output as Record<string, unknown>;

      for (const rule of listResourceRules) {
        const outputKey = rule.instanceAccess!.listKey!;
        const items = mutableOutput[outputKey];

        if (items === undefined) {
          context.logger.error(
            `resourceAccess: expected "${outputKey}" in response but not found`
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        if (!Array.isArray(items)) {
          context.logger.error(
            `resourceAccess: "${outputKey}" must be an array`
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        // If no user (anonymous), return empty list for team-filtered resources
        if (!userId || !userType) {
          mutableOutput[outputKey] = [];
          continue;
        }

        const resourceIds = items
          .map((item) => (item as { id?: string }).id)
          .filter((id): id is string => typeof id === "string");

        const hasGlobalAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(rule.qualifiedId);

        const accessibleIds = await getAccessibleResourceIdsViaS2S({
          auth: context.auth,
          userId,
          userType,
          resourceType: rule.qualifiedResourceType,
          resourceIds,
          action: rule.level,
          hasGlobalAccess,
        });

        const accessibleSet = new Set(accessibleIds);
        mutableOutput[outputKey] = items.filter((item) => {
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
 * Check resource access via auth service S2S endpoint.
 */
async function checkResourceAccessViaS2S({
  auth,
  userId,
  userType,
  resourceType,
  resourceId,
  action,
  hasGlobalAccess,
}: {
  auth: AuthService;
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceId: string;
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}): Promise<boolean> {
  try {
    const result = await auth.checkResourceTeamAccess({
      userId,
      userType,
      resourceType,
      resourceId,
      action,
      hasGlobalAccess,
    });
    return result.hasAccess;
  } catch {
    // If team access check fails (e.g., service not available), fall back to global access
    return hasGlobalAccess;
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
  hasGlobalAccess,
}: {
  auth: AuthService;
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceIds: string[];
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}): Promise<string[]> {
  if (resourceIds.length === 0) return [];

  try {
    return await auth.getAccessibleResourceIds({
      userId,
      userType,
      resourceType,
      resourceIds,
      action,
      hasGlobalAccess,
    });
  } catch {
    // If team access check fails, fall back to global access behavior
    return hasGlobalAccess ? resourceIds : [];
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
 * 3. Access rules are enforced based on meta.access
 *
 * @example
 * import { baseContractBuilder } from "@checkstack/backend-api";
 * import { access } from "./access";
 *
 * const myContract = {
 *   // User-only endpoint with specific access rule
 *   getItems: baseContractBuilder
 *     .meta({ userType: "user", accessRules: [access.myPluginRead.id] })
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
