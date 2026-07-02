import { os as baseOs, ORPCError, Router } from "@orpc/server";
import { AnyContractRouter } from "@orpc/contract";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import {
  CachePluginRegistry,
  CacheManager,
} from "@checkstack/cache-api";
import {
  type AccessLevel,
  ProcedureMetadata,
  qualifyAccessRuleId,
  qualifyResourceType,
} from "@checkstack/common";
import { SafeDatabase } from "./plugin-system";
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

  db: SafeDatabase<Record<string, unknown>>;
  logger: Logger;
  fetch: Fetch;
  auth: AuthService;
  user?: AuthUser;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  queuePluginRegistry: QueuePluginRegistry;
  queueManager: QueueManager;
  cachePluginRegistry: CachePluginRegistry;
  cacheManager: CacheManager;
  /** Emit a hook event for cross-plugin communication */
  emitHook: EmitHookFn;
  /**
   * Inbound HTTP request headers (read-only view). Populated by the
   * `/api/*` and `/rest/*` Hono handlers in `core/backend`. Optional
   * because non-HTTP call sites (S2S clients, tests, scheduled queue
   * jobs) can construct an `RpcContext` without a backing request.
   */
  requestHeaders?: Headers;
  /**
   * Mutable response headers. Middleware (e.g. `correlationMiddleware`)
   * can set headers here, and the Hono handler that drives the oRPC
   * `RPCHandler` / `OpenAPIHandler` merges them onto the actual
   * `Response` after the procedure has run. Optional for the same
   * reason as `requestHeaders`.
   */
  responseHeaders?: Headers;

  /**
   * Per-request result of the `bulkManage` instance-access mode. For each
   * `bulkManage` rule the middleware pre-partitions `input[idsParam]` into the
   * caller's manageable subset and the denied remainder, keyed by that
   * `idsParam`. A bulk WRITE handler MUST read this and mutate ONLY
   * `authorizedIds` (reporting `deniedIds` as forbidden), so an unauthorized id
   * is never acted on. Absent for every non-bulk endpoint; a handler that finds
   * it absent must treat the whole batch as denied (fail closed).
   */
  bulkAccess?: Record<
    string,
    { authorizedIds: string[]; deniedIds: string[] }
  >;
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
    // Contract-level instanceAccess override (used for bulk endpoints)
    const instanceAccessOverride = meta?.instanceAccess;

    // Build qualified access rule IDs for each access rule
    // If contract has instanceAccess override, apply it to ALL rules
    const qualifiedRules = accessRules.map((rule) => ({
      ...rule,
      // Use contract-level override if provided, otherwise use rule's config
      instanceAccess: instanceAccessOverride ?? rule.instanceAccess,
      qualifiedId: qualifyAccessRuleId(context.pluginMetadata, rule),
      qualifiedResourceType: qualifyResourceType(
        context.pluginMetadata.pluginId,
        rule.resource,
      ),
    }));

    // Separate rules by type. A rule with no instanceAccess, OR an explicit
    // `instanceAccess: { global: true }` (the deliberate "this endpoint is not
    // team-scoped" marker), is enforced purely at the global-rule level — no
    // per-resource team check. `global` and the scoping modes are mutually
    // exclusive (enforced by the boot validator).
    const globalOnlyRules = qualifiedRules.filter(
      (r) => !r.instanceAccess || r.instanceAccess.global === true,
    );
    const instanceRules = qualifiedRules.filter(
      (r) => r.instanceAccess && r.instanceAccess.global !== true,
    );
    const singleResourceRules = instanceRules.filter(
      (r) =>
        r.instanceAccess?.idParam &&
        !r.instanceAccess?.listKey &&
        !r.instanceAccess?.recordKey,
    );
    const listResourceRules = instanceRules.filter(
      (r) => r.instanceAccess?.listKey,
    );
    const recordResourceRules = instanceRules.filter(
      (r) => r.instanceAccess?.recordKey,
    );
    const createResourceRules = instanceRules.filter(
      (r) => r.instanceAccess?.create,
    );
    // Bulk-manage rules pre-partition an id ARRAY into the caller's authorized
    // subset before the handler runs (mass delete / mass resolve).
    const bulkManageRules = instanceRules.filter(
      (r) => r.instanceAccess?.bulkManage,
    );
    // Parent-scoped rules delegate the per-resource decision to a PARENT type
    // (e.g. "you may see incidents for system X iff you may see system X").
    const parentScopeRules = instanceRules.filter(
      (r) => r.instanceAccess?.parentScope,
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
      // SECURITY: Check service-level scope restrictions
      const serviceScope = meta?.serviceScope;
      if (serviceScope && serviceScope.length > 0) {
        const isAllowed = serviceScope.some((allowedPattern) => {
          if (allowedPattern.endsWith("*")) {
            const prefix = allowedPattern.slice(0, -1);
            return user.pluginId.startsWith(prefix);
          }
          return allowedPattern === user.pluginId;
        });

        if (!isAllowed) {
          throw new ORPCError("FORBIDDEN", {
            message: `Service '${user.pluginId}' is not allowed to call this endpoint`,
          });
        }
      }
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

      // Resolve the caller's global-rule verdict once (anonymous callers use
      // the anonymous role's rules; everyone else uses their own granted set).
      let hasGlobalAccess: boolean;
      if (!userId || !userType) {
        const anonymousAccessRules =
          await context.auth.getAnonymousAccessRules();
        hasGlobalAccess =
          anonymousAccessRules.includes("*") ||
          anonymousAccessRules.includes(rule.qualifiedId);
      } else {
        hasGlobalAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(rule.qualifiedId);
      }

      // FAIL CLOSED: if the configured idParam does not resolve to a resource
      // id (a typo in the contract, an optional/absent field, or a malformed
      // request) we cannot evaluate a team grant for it. Silently skipping the
      // check would grant access, so we require global access and otherwise
      // deny. The boot-time contract validator additionally cross-checks
      // idParam against the input schema to catch the typo case before any
      // traffic arrives.
      if (!resourceId) {
        if (hasGlobalAccess) continue;
        throw new ORPCError("FORBIDDEN", {
          message: `Access denied: missing resource identifier '${rule.instanceAccess!.idParam!}' for ${rule.resource}`,
        });
      }

      // Anonymous callers cannot hold team grants, so a resolved resource id
      // is reachable only via global access.
      if (!userId || !userType) {
        if (hasGlobalAccess) continue;
        throw new ORPCError("FORBIDDEN", {
          message: `Authentication required to access ${rule.resource}:${resourceId}`,
        });
      }

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

    // Pre-check: Parent-scoped endpoints (single/multi parent id).
    // "You may access this resource iff you may access its PARENT (e.g. system)."
    // The endpoint's own rule was already checked globally above; here we add the
    // per-resource decision against the parent type, consulting the parent's
    // global rule AND the caller's team grants on the parent.
    for (const rule of parentScopeRules) {
      const ps = rule.instanceAccess!.parentScope!;
      // The recordKey variant is a post-filter, handled after the handler runs.
      if (!ps.idParam) continue;
      const action = ps.action ?? "read";
      const parentGlobalRuleId = `${ps.resourceType}.${action}`;
      const parentIds = getNestedValues(input, ps.idParam);

      // Caller's GLOBAL verdict on the PARENT type (anonymous uses the anonymous
      // role's rules; everyone else uses their own granted set).
      let hasGlobalParentAccess: boolean;
      if (!userId || !userType) {
        const anon = await context.auth.getAnonymousAccessRules();
        hasGlobalParentAccess =
          anon.includes("*") || anon.includes(parentGlobalRuleId);
      } else {
        hasGlobalParentAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(parentGlobalRuleId);
      }

      // FAIL CLOSED: no resolvable parent id means we cannot evaluate scope.
      if (parentIds.length === 0) {
        if (hasGlobalParentAccess) continue;
        throw new ORPCError("FORBIDDEN", {
          message: `Access denied: missing parent identifier '${ps.idParam}' for ${ps.resourceType}`,
        });
      }

      // Anonymous callers cannot hold team grants — only global parent access.
      if (!userId || !userType) {
        if (hasGlobalParentAccess) continue;
        throw new ORPCError("FORBIDDEN", {
          message: `Authentication required to access ${ps.resourceType}`,
        });
      }

      // Authenticated: require `action` access to EVERY referenced parent.
      for (const parentId of parentIds) {
        const ok = await checkResourceAccessViaS2S({
          auth: context.auth,
          userId,
          userType,
          resourceType: ps.resourceType,
          resourceId: parentId,
          action,
          hasGlobalAccess: hasGlobalParentAccess,
        });
        if (!ok) {
          throw new ORPCError("FORBIDDEN", {
            message: `Access denied to ${ps.resourceType}:${parentId}`,
          });
        }
      }
    }

    // Pre-check: Create endpoints
    // Authorize the create via the auth service, which lets a team member who
    // holds a create-capability grant through (not just global-manage holders),
    // resolves the owning team, or throws FORBIDDEN / OWNER_TEAM_REQUIRED. The
    // resolved owner is remembered and written AFTER the handler (the resource
    // id only exists then). Only reachable for authenticated users — services
    // short-circuit earlier and anonymous fails the auth requirement.
    const pendingOwnerWrites: Array<{
      resourceType: string;
      idField: string;
      teamId: string;
      isPrivate: boolean;
    }> = [];
    if (createResourceRules.length > 0 && userId && userType) {
      for (const rule of createResourceRules) {
        const createCfg = rule.instanceAccess!.create!;
        const requestedTeamId = getNestedValue(
          input,
          createCfg.teamIdParam ?? "teamId",
        );
        const hasGlobalManage =
          userAccessRules.includes("*") ||
          userAccessRules.includes(rule.qualifiedId);

        // Parent-gated create: a caller who can MANAGE the referenced parent
        // resource(s) (e.g. the system(s) an incident is "for") is authorized to
        // create, without needing a per-type create-capability grant. They must
        // be able to manage ALL referenced parents.
        let parentAuthorized = false;
        if (createCfg.parent) {
          const parentIds = getNestedValues(input, createCfg.parent.idParam);
          if (parentIds.length > 0) {
            const parentType = createCfg.parent.resourceType;
            const hasGlobalParentManage =
              userAccessRules.includes("*") ||
              userAccessRules.includes(`${parentType}.manage`);
            const checks = await Promise.all(
              parentIds.map((parentId) =>
                checkResourceAccessViaS2S({
                  auth: context.auth,
                  userId,
                  userType,
                  resourceType: parentType,
                  resourceId: parentId,
                  action: "manage",
                  hasGlobalAccess: hasGlobalParentManage,
                }),
              ),
            );
            parentAuthorized = checks.every(Boolean);
          }
        }

        // Propagates ORPCError (FORBIDDEN / BAD_REQUEST OWNER_TEAM_REQUIRED) to
        // the caller. Not fail-open: a create that cannot be authorized must be
        // rejected. `alreadyAuthorized` short-circuits the per-type
        // create-capability requirement when the parent gate already passed.
        const { ownerTeamId, isPrivate } =
          await context.auth.authorizeCreate({
            userId,
            userType,
            objectType: rule.qualifiedResourceType,
            requestedTeamId,
            hasGlobalManage,
            alreadyAuthorized: parentAuthorized,
          });

        if (ownerTeamId) {
          pendingOwnerWrites.push({
            resourceType: rule.qualifiedResourceType,
            idField: createCfg.idField ?? "id",
            teamId: ownerTeamId,
            isPrivate,
          });
        }
      }
    }

    // Pre-handler: bulk-manage endpoints.
    // Partition each declared id array into the caller's authorized subset
    // (global rule OR per-id manage grant) and the denied remainder, and expose
    // both to the handler via `context.bulkAccess`. This runs BEFORE the handler
    // so a bulk WRITE never mutates an unauthorized id (the fail-open hazard of
    // a post-filter on a mutation). Only reachable for authenticated real users
    // — services short-circuit at step 5 and anonymous fails step 3.
    const bulkAccess: Record<
      string,
      { authorizedIds: string[]; deniedIds: string[] }
    > = {};
    if (bulkManageRules.length > 0 && userId && userType) {
      for (const rule of bulkManageRules) {
        const idsParam = rule.instanceAccess!.bulkManage!.idsParam;
        const requestedIds = [...new Set(getNestedValues(input, idsParam))];
        const hasGlobalAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(rule.qualifiedId);

        // A global-manage caller is authorized for every id; a team-scoped
        // caller gets only the ids their grants cover (fail-closed on S2S
        // error → empty subset via getAccessibleResourceIdsViaS2S).
        const authorizedIds = hasGlobalAccess
          ? requestedIds
          : await getAccessibleResourceIdsViaS2S({
              auth: context.auth,
              userId,
              userType,
              resourceType: rule.qualifiedResourceType,
              resourceIds: requestedIds,
              action: rule.level,
              hasGlobalAccess,
            });

        const authorizedSet = new Set(authorizedIds);
        bulkAccess[idsParam] = {
          authorizedIds: requestedIds.filter((id) => authorizedSet.has(id)),
          deniedIds: requestedIds.filter((id) => !authorizedSet.has(id)),
        };
      }
    }

    // Execute handler. Partial-merge style (no `...context` spread) so the
    // bulkAccess partition reaches the handler without widening the inferred
    // context chain type (see correlationMiddleware for the rationale).
    const result =
      Object.keys(bulkAccess).length > 0
        ? await next({ context: { bulkAccess } })
        : await next({});

    // Post-grant: write the owning-team grant for newly-created resources, now
    // that the handler has produced the resource id. The handler has ALREADY
    // committed the resource row at this point, so there is no rollback: if the
    // owner write fails the auth client re-throws and the create surfaces a
    // 5xx, leaving the resource ownerless (it falls back to global-rule access,
    // not the intended team — a consistency gap, not a leak). Re-throwing keeps
    // the failure loud; a cross-store saga/reconciler would be the real fix.
    if (
      pendingOwnerWrites.length > 0 &&
      result.output &&
      typeof result.output === "object"
    ) {
      for (const write of pendingOwnerWrites) {
        const resourceId = getNestedValue(result.output, write.idField);
        if (!resourceId) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: `Create succeeded but no resource id found at "${write.idField}" to record team ownership`,
          });
        }
        await context.auth.setOwner({
          objectType: write.resourceType,
          objectId: resourceId,
          teamId: write.teamId,
          // Only mark private when explicitly requested. The default is a
          // team-managed, globally-readable object (a `public` viewer marker).
          isPrivate: write.isPrivate ? true : undefined,
        });
      }
    }

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
            `resourceAccess: expected "${outputKey}" in response but not found`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        if (!Array.isArray(items)) {
          context.logger.error(
            `resourceAccess: "${outputKey}" must be an array`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        // If no user (anonymous), check if they have global access via anonymous role
        if (!userId || !userType) {
          // Anonymous users can't have team grants, but may have global access
          const anonymousAccessRules =
            await context.auth.getAnonymousAccessRules();
          const hasGlobalAccess =
            anonymousAccessRules.includes("*") ||
            anonymousAccessRules.includes(rule.qualifiedId);

          if (hasGlobalAccess) {
            // Anonymous user has global access - return all items
            continue;
          } else {
            // No global access and can't have team grants - return empty
            mutableOutput[outputKey] = [];
            continue;
          }
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
        const filtered = items.filter((item) => {
          const id = (item as { id?: string }).id;
          return id && accessibleSet.has(id);
        });

        // G11: an empty result for an authenticated caller with no global
        // access could mean "scoped to an empty subset" (200) OR "categorically
        // unauthorized" (403). Disambiguate via a type-level grant check and
        // surface a meaningful 403 in the latter case instead of a silent [].
        if (
          filtered.length === 0 &&
          (await isCategoricallyUnauthorizedViaS2S({
            auth: context.auth,
            userId,
            userType,
            resourceType: rule.qualifiedResourceType,
            action: rule.level,
            hasGlobalAccess,
          }))
        ) {
          throw resourceScopeDenied(rule);
        }

        mutableOutput[outputKey] = filtered;
      }
    }

    // Post-filter: Record endpoints (bulk queries returning Record<resourceId, data>)
    // For these, remove record keys user doesn't have access to
    if (
      recordResourceRules.length > 0 &&
      result.output &&
      typeof result.output === "object"
    ) {
      const mutableOutput = result.output as Record<string, unknown>;

      for (const rule of recordResourceRules) {
        const outputKey = rule.instanceAccess!.recordKey!;
        const record = mutableOutput[outputKey];

        if (record === undefined) {
          context.logger.error(
            `resourceAccess: expected "${outputKey}" in response but not found`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        if (
          typeof record !== "object" ||
          record === null ||
          Array.isArray(record)
        ) {
          context.logger.error(
            `resourceAccess: "${outputKey}" must be an object (record)`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        const recordObj = record as Record<string, unknown>;
        const resourceIds = Object.keys(recordObj);

        // If no user (anonymous), check if they have global access via anonymous role
        if (!userId || !userType) {
          const anonymousAccessRules =
            await context.auth.getAnonymousAccessRules();
          const hasGlobalAccess =
            anonymousAccessRules.includes("*") ||
            anonymousAccessRules.includes(rule.qualifiedId);

          if (hasGlobalAccess) {
            // Anonymous user has global access - return all items
            continue;
          } else {
            // No global access and can't have team grants - return empty record
            mutableOutput[outputKey] = {};
            continue;
          }
        }

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
        const filteredRecord: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(recordObj)) {
          if (accessibleSet.has(key)) {
            filteredRecord[key] = value;
          }
        }

        // G11: same disambiguation as the list branch — a categorically
        // unauthorized caller gets a 403, not a silently-emptied record.
        if (
          Object.keys(filteredRecord).length === 0 &&
          (await isCategoricallyUnauthorizedViaS2S({
            auth: context.auth,
            userId,
            userType,
            resourceType: rule.qualifiedResourceType,
            action: rule.level,
            hasGlobalAccess,
          }))
        ) {
          throw resourceScopeDenied(rule);
        }

        mutableOutput[outputKey] = filteredRecord;
      }
    }

    // Post-filter: Parent-scoped record endpoints (bulk queries returning
    // Record<parentId, data>). Strip keys whose PARENT the caller cannot access.
    if (
      parentScopeRules.length > 0 &&
      result.output &&
      typeof result.output === "object"
    ) {
      const mutableOutput = result.output as Record<string, unknown>;

      for (const rule of parentScopeRules) {
        const ps = rule.instanceAccess!.parentScope!;
        // The idParam variant is a pre-check, handled before the handler ran.
        if (!ps.recordKey) continue;
        const action = ps.action ?? "read";
        const parentGlobalRuleId = `${ps.resourceType}.${action}`;
        const outputKey = ps.recordKey;
        const record = mutableOutput[outputKey];

        if (record === undefined) {
          context.logger.error(
            `resourceAccess: expected "${outputKey}" in response but not found`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }
        if (
          typeof record !== "object" ||
          record === null ||
          Array.isArray(record)
        ) {
          context.logger.error(
            `resourceAccess: "${outputKey}" must be an object (record)`,
          );
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Invalid response shape for filtered endpoint",
          });
        }

        const recordObj = record as Record<string, unknown>;
        const parentIds = Object.keys(recordObj);

        if (!userId || !userType) {
          const anon = await context.auth.getAnonymousAccessRules();
          const hasGlobalParentAccess =
            anon.includes("*") || anon.includes(parentGlobalRuleId);
          if (hasGlobalParentAccess) continue;
          mutableOutput[outputKey] = {};
          continue;
        }

        const hasGlobalParentAccess =
          userAccessRules.includes("*") ||
          userAccessRules.includes(parentGlobalRuleId);

        const accessibleIds = await getAccessibleResourceIdsViaS2S({
          auth: context.auth,
          userId,
          userType,
          resourceType: ps.resourceType,
          resourceIds: parentIds,
          action,
          hasGlobalAccess: hasGlobalParentAccess,
        });

        const accessibleSet = new Set(accessibleIds);
        const filteredRecord: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(recordObj)) {
          if (accessibleSet.has(key)) filteredRecord[key] = value;
        }

        if (
          Object.keys(filteredRecord).length === 0 &&
          (await isCategoricallyUnauthorizedViaS2S({
            auth: context.auth,
            userId,
            userType,
            resourceType: ps.resourceType,
            action,
            hasGlobalAccess: hasGlobalParentAccess,
          }))
        ) {
          throw resourceScopeDenied({
            resource: ps.resourceType,
            level: action,
            qualifiedId: parentGlobalRuleId,
            qualifiedResourceType: ps.resourceType,
          });
        }

        mutableOutput[outputKey] = filteredRecord;
      }
    }

    return result;
  },
);

// =============================================================================
// CORRELATION ID MIDDLEWARE
// =============================================================================

/**
 * Name of the inbound and outbound HTTP header that carries the correlation
 * ID. Exported so dev tools, integration tests, and front-end fetch wrappers
 * can refer to the canonical value rather than hard-coding the string.
 */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/**
 * Per-request observability middleware.
 *
 * Behaviour:
 * - Reads `x-correlation-id` from `context.requestHeaders` (populated by the
 *   `/api/*` and `/rest/*` Hono handlers in `core/backend`).
 * - Generates a fresh UUID v4 via `crypto.randomUUID()` if absent. This is
 *   the ONLY generation site for correlation IDs in the platform — handlers
 *   must NOT mint new IDs on their own.
 * - Binds `{ correlationId, pluginId, userId? }` onto a child logger via
 *   `ctx.logger.child(...)` so every subsequent log line in the request
 *   carries that metadata automatically.
 * - Writes the ID back to `context.responseHeaders` (if available) so the
 *   outer Hono handler can echo `x-correlation-id` on the response, letting
 *   the caller correlate their own client-side trace to the server log.
 *
 * Note on the echo: oRPC middleware has no direct access to the outgoing
 * `Response` object — the framework constructs it from the procedure's
 * return value AFTER middleware has finished. We use the mutable
 * `responseHeaders` bag on `RpcContext` as a thin write-through: the Hono
 * route handler merges those headers onto the `Response` post-handle. When
 * an `RpcContext` is constructed without `responseHeaders` (S2S clients,
 * tests), the echo silently no-ops; the ID is still bound to the child
 * logger so server-side correlation still works.
 *
 * Order matters: in plugin routers, `.use(correlationMiddleware)` MUST
 * appear BEFORE `.use(autoAuthMiddleware)` so that auth failures still log
 * with the correlation ID attached.
 *
 * Usage:
 *
 *   const os = implement(myContract)
 *     .$context<RpcContext>()
 *     .use(correlationMiddleware)
 *     .use(autoAuthMiddleware);
 */
export const correlationMiddleware = os.middleware(
  async ({ next, context }) => {
    const incoming = context.requestHeaders?.get(CORRELATION_ID_HEADER);
    const correlationId =
      incoming && incoming.length > 0 ? incoming : crypto.randomUUID();

    context.responseHeaders?.set(CORRELATION_ID_HEADER, correlationId);

    const meta: Record<string, unknown> = {
      correlationId,
      pluginId: context.pluginMetadata.pluginId,
    };
    if (context.user && "id" in context.user) {
      meta.userId = context.user.id;
    }

    // `child` is optional on the Logger interface so minimal test-mock
    // loggers don't have to implement it. Production Winston loggers
    // always do; gracefully fall back to the base logger otherwise so
    // the middleware never breaks a request just because metadata
    // binding wasn't possible.
    const boundLogger = context.logger.child
      ? context.logger.child(meta)
      : context.logger;

    // Partial-merge style (no `...context` spread): oRPC merges the
    // returned context fields onto the existing context. Spreading
    // would widen TypeScript's inferred chain type and surface
    // TS2883 "inferred type cannot be named" errors in downstream
    // packages whose routers compose this middleware.
    return next({
      context: {
        logger: boundLogger,
      },
    });
  },
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
 * Like getNestedValue, but resolves a value that may be a single string or an
 * array of strings (e.g. an incident's `systemIds`) to a string array. Returns
 * an empty array when absent. Used by parent-gated create authorization.
 */
function getNestedValues(obj: unknown, path: string): string[] {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return [];
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "string") return [current];
  if (Array.isArray(current)) {
    return current.filter((v): v is string => typeof v === "string");
  }
  return [];
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
    const result = await auth.check({
      userId,
      userType,
      objectType: resourceType,
      objectId: resourceId,
      action,
      hasGlobalAccess,
    });
    return result.hasAccess;
  } catch {
    // SECURITY: Fail-Closed — deny access when S2S check fails
    return false;
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
    return await auth.listAccessibleObjectIds({
      userId,
      userType,
      objectType: resourceType,
      objectIds: resourceIds,
      action,
      hasGlobalAccess,
    });
  } catch {
    // SECURITY: Fail-Closed — return empty set when S2S check fails
    return [];
  }
}

/**
 * Decide whether an authenticated caller is *categorically* unauthorized for a
 * resource type on a list/record endpoint: they have no global access rule AND
 * hold no team grant of the required level for the type. Such a caller should
 * receive a meaningful 403 rather than a silently-emptied 200 (G11).
 *
 * Fails OPEN (returns false = "not categorically unauthorized") when the S2S
 * lookup errors: the data is already protected by the post-filter, so a
 * transient auth blip should degrade to a 200-empty response, never escalate to
 * a hard 403 for a caller who may in fact have access.
 */
async function isCategoricallyUnauthorizedViaS2S({
  auth,
  userId,
  userType,
  resourceType,
  action,
  hasGlobalAccess,
}: {
  auth: AuthService;
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}): Promise<boolean> {
  if (hasGlobalAccess) return false;
  try {
    const { hasGrant } = await auth.hasAnyTypeGrant({
      userId,
      userType,
      objectType: resourceType,
      action,
    });
    return !hasGrant;
  } catch {
    return false;
  }
}

/**
 * Structured 403 body for a categorically-unauthorized list/record read.
 * Surfaced in `ORPCError.data` so callers (and API clients) get an actionable
 * reason and the exact missing access rule instead of a silent empty payload.
 */
function resourceScopeDenied(rule: {
  resource: string;
  level: AccessLevel;
  qualifiedId: string;
  qualifiedResourceType: string;
}): ORPCError<"FORBIDDEN", unknown> {
  return new ORPCError("FORBIDDEN", {
    message: `Not authorized to ${rule.level} ${rule.qualifiedResourceType}`,
    data: {
      reason: "resource_scope_denied",
      resourceType: rule.qualifiedResourceType,
      requiredAccess: rule.level,
      missingGlobalRule: rule.qualifiedId,
      hint:
        `You have no global access to this resource type and belong to no ` +
        `team granted access. Ask an administrator to grant your team access ` +
        `or assign the '${rule.qualifiedId}' access rule.`,
    },
  });
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
    contract: C,
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
    path?: string,
  ): void;
}

export { z as zod } from "zod";
export * from "./contract";
