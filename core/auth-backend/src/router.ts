import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
  type AuthUser,
  type RealUser,
  type AuthStrategy,
  type ConfigService,
  toJsonSchema,
} from "@checkstack/backend-api";
import {
  authContract,
  passwordSchema,
  authAccess,
  pluginMetadata,
  isApplicationBindable,
} from "@checkstack/auth-common";
import { qualifyAccessRuleId, isAccessRuleSatisfied } from "@checkstack/common";
import { hashPassword } from "better-auth/crypto";
import * as schema from "./schema";
import { RelationTupleStore } from "./relation-tuple-store";

/** Narrow the store's string relation to the access-relation union. */
function asRelation(r: string): "viewer" | "editor" | "owner" {
  return r === "owner" ? "owner" : r === "editor" ? "editor" : "viewer";
}
import { eq, inArray, and, or, ilike, sql } from "drizzle-orm";
import type { SafeDatabase, ResourceResolver } from "@checkstack/backend-api";
import { authHooks } from "./hooks";
import {
  enrichApplicationPrincipal as resolveApplicationPrincipal,
  resolveAllApplicationAccessRules,
} from "./utils/user";
import { RoleMembershipStore } from "./role-membership-store";
import { type AuthCache, createNoopAuthCache } from "./auth-cache";

/**
 * Type guard to check if user is a RealUser (not a service).
 */
function isRealUser(user: AuthUser | undefined): user is RealUser {
  return user?.type === "user";
}
import {
  strategyMetaConfigV1,
  STRATEGY_META_CONFIG_VERSION,
} from "./meta-config";
import {
  platformRegistrationConfigV1,
  PLATFORM_REGISTRATION_CONFIG_VERSION,
  PLATFORM_REGISTRATION_CONFIG_ID,
} from "./platform-registration-config";
import {
  mcpOAuthConfigV1,
  MCP_OAUTH_CONFIG_VERSION,
  MCP_OAUTH_CONFIG_ID,
} from "./mcp-oauth-config";

import {
  ADMIN_ROLE_ID,
  USERS_ROLE_ID,
  ANONYMOUS_ROLE_ID,
  APPLICATIONS_ROLE_ID,
} from "./role-ids";

/**
 * Creates the auth router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(authContract)
  .$context<RpcContext>()
  .use(correlationMiddleware)
  .use(autoAuthMiddleware);

/**
 * Get the enabled state for an authentication strategy from its meta config.
 *
 * @param strategyId - The ID of the strategy
 * @param configService - The ConfigService instance
 * @returns The enabled state:
 *  - If meta config exists: returns the stored enabled value
 *  - If no meta config (fresh install): defaults to true for credential, false for others
 */
async function getStrategyEnabled(
  strategyId: string,
  configService: ConfigService,
): Promise<boolean> {
  const metaConfig = await configService.get(
    `${strategyId}.meta`,
    strategyMetaConfigV1,
    STRATEGY_META_CONFIG_VERSION,
  );

  // Default: credential=true (fresh installs), others=false (require explicit config)
  return metaConfig?.enabled ?? strategyId === "credential";
}

/**
 * Set the enabled state for an authentication strategy in its meta config.
 */
async function setStrategyEnabled(
  strategyId: string,
  enabled: boolean,
  configService: ConfigService,
): Promise<void> {
  await configService.set(
    `${strategyId}.meta`,
    strategyMetaConfigV1,
    STRATEGY_META_CONFIG_VERSION,
    { enabled },
  );
}

/**
 * Check if platform-wide registration is currently allowed.
 *
 * @param configService - The ConfigService instance
 * @returns true if registration is allowed, false otherwise
 */
async function isRegistrationAllowed(
  configService: ConfigService,
): Promise<boolean> {
  const config = await configService.get(
    PLATFORM_REGISTRATION_CONFIG_ID,
    platformRegistrationConfigV1,
    PLATFORM_REGISTRATION_CONFIG_VERSION,
  );
  return config?.allowRegistration ?? true;
}

export interface AuthStrategyInfo {
  id: string;
}

/**
 * Generate a cryptographically secure 32-character secret for API applications.
 */
function generateSecret(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

/**
 * True when the caller may read EVERY team: a trusted service, or a real user
 * whose grants satisfy the global `auth.teams.read` rule - i.e. `*`, the rule
 * itself, or `auth.teams.manage` (manage implies read, per `isAccessRuleSatisfied`).
 * A user without it is scoped to the teams they are a member or manager of.
 */
function hasGlobalTeamsRead(user: AuthUser | undefined): boolean {
  if (user?.type === "service") return true;
  return isAccessRuleSatisfied(user?.accessRules ?? [], authAccess.teams.read);
}

async function assertTeamManagementAccess({
  user,
  teamId,
  internalDb,
}: {
  user: AuthUser | undefined;
  teamId: string;
  internalDb: SafeDatabase<typeof schema>;
}): Promise<void> {
  // Services are trusted via middleware
  if (user?.type === "service") return;

  const hasGlobalManage =
    user?.accessRules?.includes("*") ||
    user?.accessRules?.includes(
      qualifyAccessRuleId(pluginMetadata, authAccess.teams.manage),
    );

  if (hasGlobalManage) return; // Global manage allows all teams

  // Check if user is a manager of this specific team
  if (isRealUser(user)) {
    const [managerRecord] = await internalDb
      .select()
      .from(schema.teamManager)
      .where(
        and(
          eq(schema.teamManager.teamId, teamId),
          eq(schema.teamManager.userId, user.id),
        ),
      )
      .limit(1);

    if (managerRecord) return; // Is team manager
  }

  throw new ORPCError("FORBIDDEN", {
    message: "You do not have permission to manage this team",
  });
}

const DEFAULT_LOGGER = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

export const createAuthRouter = (
  internalDb: SafeDatabase<typeof schema>,
  strategyRegistry: { getStrategies: () => AuthStrategy<unknown>[] },
  reloadAuthFn: () => Promise<void>,
  configService: ConfigService,
  accessRuleRegistry: {
    getAccessRules: () => {
      id: string;
      description?: string;
      isDefault?: boolean;
      isPublic?: boolean;
      /** Whether an anonymous caller can actually use this rule (a public RPC requires it). */
      anonymousUsable?: boolean;
    }[];
    /** Team-scopable resource kinds for the teams admin UI (optional in tests). */
    getResourceKinds?: () => {
      resourceType: string;
      label: string;
      pluginId: string;
      createCapable: boolean;
    }[];
  },
  getBetterAuth: () =>
    | { handler: (request: Request) => Promise<Response> }
    | undefined,
  logger: {
    info: (msg: string, metadata?: Record<string, unknown>) => void;
    error: (msg: string, metadata?: Record<string, unknown>) => void;
    debug: (msg: string, metadata?: Record<string, unknown>) => void;
  } = DEFAULT_LOGGER,
  /**
   * Cross-plugin resource resolver registry (optional in tests). Lets the Teams
   * UI render grants by name and search resources to grant. Each owning plugin
   * populates it at init.
   */
  resourceResolverRegistry?: {
    get(resourceType: string): ResourceResolver | undefined;
  },
  /**
   * Shared auth read-path cache. Defaults to a no-op cache (uncached, no-op
   * invalidation) for test harnesses that don't exercise the role/user caches;
   * production ALWAYS passes the real {@link createAuthCache}.
   */
  authCache: AuthCache = createNoopAuthCache(),
) => {
  // The single sanctioned writer of role / role_access_rule / user_role. Every
  // mutation of those tables MUST go through this store so the write and its
  // shared-cache invalidation can never drift apart (enforced by the
  // `no-direct-role-membership-writes` lint rule).
  const roleMembershipStore = new RoleMembershipStore(internalDb, authCache);

  // Public endpoint for enabled strategies (no authentication required)
  const getEnabledStrategies = os.getEnabledStrategies.handler(async () => {
    const registeredStrategies = strategyRegistry.getStrategies();

    const enabledStrategies = await Promise.all(
      registeredStrategies.map(async (strategy) => {
        // Get enabled state from meta config
        const enabled = await getStrategyEnabled(strategy.id, configService);

        // Determine strategy type (backward compatibility)
        let type: "credential" | "social" | "ldap" | "saml" = "social";
        if (strategy.id === "credential") {
          type = "credential";
        } else if (strategy.clientFlow?.type === "form") {
          type = "ldap"; // Map generic 'form' to 'ldap' for frontend compat
        } else if (strategy.clientFlow?.type === "redirect") {
          type = "saml"; // Map generic 'redirect' to 'saml' for frontend compat
        }

        return {
          id: strategy.id,
          displayName: strategy.displayName,
          description: strategy.description,
          type,
          enabled,
          icon: strategy.icon,
          requiresManualRegistration: strategy.requiresManualRegistration,
          clientFlow: strategy.clientFlow,
        };
      }),
    );

    // Filter to only return enabled strategies
    return enabledStrategies.filter((s) => s.enabled);
  });

  // The configurable "anonymous" role's grants - what an unauthenticated visitor
  // is allowed. Same `roleAccessRule` store the enriched `user.accessRules` is
  // built from, so the format matches and the frontend's access checks behave
  // identically for guests and users.
  const loadAnonymousAccessRules = async (): Promise<string[]> => {
    const rolePerms = await internalDb
      .select()
      .from(schema.roleAccessRule)
      .where(eq(schema.roleAccessRule.roleId, ANONYMOUS_ROLE_ID));
    return rolePerms.map((rp) => rp.accessRuleId);
  };

  const accessRulesHandler = os.accessRules.handler(async ({ context }) => {
    const user = context.user;
    // Anonymous callers get the anonymous role's effective rules (NOT empty), so
    // the UI can gate on what a guest may actually do.
    if (!isRealUser(user)) {
      return { accessRules: await loadAnonymousAccessRules(), isInAnyTeam: false };
    }
    // `isInAnyTeam` lets the frontend show the Teams page/nav to a team-scoped
    // user who holds no global rule. It must count MANAGER-only teams too
    // (managers are not necessarily members), so `user.teamIds` - which is
    // membership-only - is not sufficient on its own: fall back to a manager
    // lookup only when the user is a member of no team (the cheap common case
    // short-circuits without the extra query).
    let isInAnyTeam = (user.teamIds?.length ?? 0) > 0;
    if (!isInAnyTeam) {
      const [managerRow] = await internalDb
        .select({ teamId: schema.teamManager.teamId })
        .from(schema.teamManager)
        .where(eq(schema.teamManager.userId, user.id))
        .limit(1);
      isInAnyTeam = !!managerRow;
    }
    return { accessRules: user.accessRules || [], isInAnyTeam };
  });

  const getUsers = os.getUsers.handler(async () => {
    const users = await internalDb.select().from(schema.user);
    if (users.length === 0) return [];

    const userRoles = await internalDb
      .select()
      .from(schema.userRole)
      .where(
        inArray(
          schema.userRole.userId,
          users.map((u) => u.id),
        ),
      );

    return users.map((u) => ({
      ...u,
      roles: userRoles
        .filter((ur) => ur.userId === u.id)
        .map((ur) => ur.roleId),
    }));
  });

  const searchUsers = os.searchUsers.handler(async ({ input, context }) => {
    // The contract gates this `access: []` (any authenticated caller passes the
    // middleware) so team managers - who hold no global rule - aren't 403'd, but
    // that alone would let any logged-in user enumerate the full user directory
    // (names + emails). This endpoint exists only to feed the team add-member
    // picker, so we further restrict it HERE to callers who actually administer a
    // team: a global team-manager (admin) OR a manager of at least one specific
    // team. A plain member with no management role has no reason to search the
    // directory and is denied.
    const user = context.user;
    if (user?.type === "service") {
      // Trusted S2S caller; no directory restriction.
    } else {
      const hasGlobalManage =
        user?.accessRules?.includes("*") ||
        user?.accessRules?.includes(
          qualifyAccessRuleId(pluginMetadata, authAccess.teams.manage),
        );
      if (!hasGlobalManage) {
        let managesAnyTeam = false;
        if (isRealUser(user)) {
          const [managerRecord] = await internalDb
            .select({ teamId: schema.teamManager.teamId })
            .from(schema.teamManager)
            .where(eq(schema.teamManager.userId, user.id))
            .limit(1);
          managesAnyTeam = !!managerRecord;
        }
        if (!managesAnyTeam) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "Searching the user directory requires managing at least one team.",
          });
        }
      }
    }

    const q = input.query.trim();
    if (q.length === 0) return [];
    const pattern = `%${q}%`;
    const rows = await internalDb
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.user)
      .where(
        or(ilike(schema.user.name, pattern), ilike(schema.user.email, pattern)),
      )
      .limit(20);
    return rows;
  });

  const deleteUser = os.deleteUser.handler(async ({ input: id, context }) => {
    // Check if user has admin role - prevent deletion to avoid lockout
    const userRoles = await internalDb
      .select({ roleId: schema.userRole.roleId })
      .from(schema.userRole)
      .where(eq(schema.userRole.userId, id));

    if (userRoles.some((ur) => ur.roleId === ADMIN_ROLE_ID)) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot delete users with the admin role",
      });
    }

    // Delete user and all related records in a transaction
    // Foreign keys are set to "ON DELETE no action", so we must manually delete related records
    await internalDb.transaction(async (tx) => {
      // Delete user roles (via the store, which owns writes to `user_role`). No
      // cache broadcast: a deleted user can never authenticate, so a stale
      // user -> roles entry is never read and expires via the TTL.
      await roleMembershipStore.deleteUserMemberships({ runner: tx, userId: id });

      // Delete sessions
      await tx.delete(schema.session).where(eq(schema.session.userId, id));

      // Delete accounts
      await tx.delete(schema.account).where(eq(schema.account.userId, id));

      // Finally, delete the user
      await tx.delete(schema.user).where(eq(schema.user.id, id));
    });

    // Emit hook for cross-plugin cleanup (notifications, theme preferences, etc.)
    await context.emitHook(authHooks.userDeleted, { userId: id });
  });

  const getRoles = os.getRoles.handler(async () => {
    const roles = await internalDb.select().from(schema.role);
    const roleAccessRules = await internalDb
      .select()
      .from(schema.roleAccessRule);

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      accessRules: roleAccessRules
        .filter((rp) => rp.roleId === role.id)
        .map((rp) => rp.accessRuleId),
      isSystem: role.isSystem || false,
      // Anonymous role cannot be assigned to users - it's for unauthenticated access
      isAssignable: role.id !== ANONYMOUS_ROLE_ID,
    }));
  });

  const getAccessRules = os.getAccessRules.handler(async () => {
    // Return only currently active access rules (registered by loaded plugins)
    return accessRuleRegistry.getAccessRules();
  });

  const createRole = os.createRole.handler(async ({ input }) => {
    const { name, description, accessRules: inputAccessRules } = input;

    // Generate UUID for new role
    const id = crypto.randomUUID();

    // Get active access rules to filter input
    const activeAccessRules = new Set(
      accessRuleRegistry.getAccessRules().map((p) => p.id),
    );

    // Filter to only include active access rules
    const validAccessRules = inputAccessRules.filter((p) =>
      activeAccessRules.has(p),
    );

    // The store owns the write (+ any cache invalidation). A brand-new role
    // cannot be cached yet, so createRole needs no invalidation.
    await roleMembershipStore.createRole({
      id,
      name,
      description: description || undefined,
      accessRuleIds: validAccessRules,
    });
  });

  const updateRole = os.updateRole.handler(async ({ input, context }) => {
    const { id, name, description, accessRules: inputAccessRules } = input;

    // Track if user has this role (for access elevation prevention). A platform
    // admin (wildcard `*`) is exempt: they already hold every access rule, so
    // editing a role they belong to cannot elevate them - and blocking it would
    // lock them out of configuring roles they were automatically added to.
    const userRoles = isRealUser(context.user) ? context.user.roles || [] : [];
    const isWildcardAdmin =
      isRealUser(context.user) &&
      (context.user.accessRules || []).includes("*");
    const isUserOwnRole = userRoles.includes(id) && !isWildcardAdmin;

    // Check if role exists
    const existingRole = await internalDb
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, id));

    if (existingRole.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: `Role ${id} not found`,
      });
    }

    const isUsersRole = id === USERS_ROLE_ID;
    const isAdminRole = id === ADMIN_ROLE_ID;

    // System roles can have name/description edited, but not deleted
    // Admin role: access rules cannot be changed (wildcard access)
    // Users role: access rules can be changed with default tracking
    // User's own role: access rules cannot be changed (prevent access elevation)

    // Get active access rules to filter input
    const activeAccessRules = new Set(
      accessRuleRegistry.getAccessRules().map((p) => p.id),
    );

    // Filter to only include active access rules
    const validAccessRules = inputAccessRules.filter((p) =>
      activeAccessRules.has(p),
    );

    // Track disabled authenticated default access rules for "users" role
    if (isUsersRole && !isUserOwnRole) {
      const allPerms = accessRuleRegistry.getAccessRules();
      const defaultPermIds = allPerms
        .filter((p) => p.isDefault)
        .map((p) => p.id);

      // Find authenticated default access rules that are being removed
      const removedDefaults = defaultPermIds.filter(
        (defId) => !validAccessRules.includes(defId),
      );

      // Insert into disabled_default_access_rule table
      for (const permId of removedDefaults) {
        await internalDb
          .insert(schema.disabledDefaultAccessRule)
          .values({
            accessRuleId: permId,
            disabledAt: new Date(),
          })
          .onConflictDoNothing();
      }

      // Remove from disabled table if being re-added
      const readdedDefaults = validAccessRules.filter((p) =>
        defaultPermIds.includes(p),
      );
      for (const permId of readdedDefaults) {
        await internalDb
          .delete(schema.disabledDefaultAccessRule)
          .where(eq(schema.disabledDefaultAccessRule.accessRuleId, permId));
      }
    }

    // Track disabled public default access rules for "anonymous" role
    const isAnonymousRole = id === ANONYMOUS_ROLE_ID;
    if (isAnonymousRole) {
      const allPerms = accessRuleRegistry.getAccessRules();

      // GUARDRAIL: refuse to ADD an access rule to the anonymous role that no
      // `public` endpoint uses. The auth middleware rejects unauthenticated
      // callers BEFORE checking access rules, so such a grant is inert and
      // misleading (the admin would think anonymous users gained a capability
      // they cannot actually use). Only NEWLY-added inert rules are blocked;
      // anything already on the role is left untouched so this can never wedge
      // an existing configuration.
      const usableIds = new Set(
        allPerms.filter((p) => p.anonymousUsable).map((p) => p.id),
      );
      const currentAnonRows = await internalDb
        .select()
        .from(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.roleId, ANONYMOUS_ROLE_ID));
      const currentAnonRules = new Set(
        currentAnonRows.map((r) => r.accessRuleId),
      );
      const inertAdditions = validAccessRules.filter(
        (p) => !usableIds.has(p) && !currentAnonRules.has(p),
      );
      if (inertAdditions.length > 0) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "These access rules cannot be granted to the anonymous role - no " +
            "public endpoint uses them, so only authenticated callers could " +
            `ever exercise them: ${inertAdditions.join(", ")}`,
        });
      }

      const publicDefaultPermIds = allPerms
        .filter((p) => p.isPublic)
        .map((p) => p.id);

      // Find public default access rules that are being removed
      const removedPublicDefaults = publicDefaultPermIds.filter(
        (defId) => !validAccessRules.includes(defId),
      );

      // Insert into disabled_public_default_access_rule table
      for (const permId of removedPublicDefaults) {
        await internalDb
          .insert(schema.disabledPublicDefaultAccessRule)
          .values({
            accessRuleId: permId,
            disabledAt: new Date(),
          })
          .onConflictDoNothing();
      }

      // Remove from disabled table if being re-added
      const readdedPublicDefaults = validAccessRules.filter((p) =>
        publicDefaultPermIds.includes(p),
      );
      for (const permId of readdedPublicDefaults) {
        await internalDb
          .delete(schema.disabledPublicDefaultAccessRule)
          .where(
            eq(schema.disabledPublicDefaultAccessRule.accessRuleId, permId),
          );
      }
    }

    // Persist via the store, which owns the write + shared-cache invalidation
    // (including the separate anonymous-role entry). Access rules are left
    // untouched for the admin role (wildcard) and the caller's own role
    // (prevents self-elevation); passing `undefined` skips the rule replace AND
    // its invalidation, matching the previous early-return.
    await roleMembershipStore.updateRole({
      roleId: id,
      name,
      description,
      replaceAccessRuleIds:
        isAdminRole || isUserOwnRole ? undefined : validAccessRules,
    });
  });

  const deleteRole = os.deleteRole.handler(async ({ input: id, context }) => {
    // Security check: prevent users from deleting their own roles (access
    // elevation / self-lockout). A platform admin (wildcard `*`) is exempt -
    // they hold every rule regardless of role membership, and blocking this
    // would stop them managing roles they were automatically added to. System
    // roles remain undeletable via the `isSystem` check below.
    const userRoles = isRealUser(context.user) ? context.user.roles || [] : [];
    const isWildcardAdmin =
      isRealUser(context.user) &&
      (context.user.accessRules || []).includes("*");
    if (userRoles.includes(id) && !isWildcardAdmin) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot delete a role that you currently have",
      });
    }

    // Check if role is a system role
    const existingRole = await internalDb
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, id));

    if (existingRole.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: `Role ${id} not found`,
      });
    }

    if (existingRole[0].isSystem) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot delete system role",
      });
    }

    // The store deletes the role + its rule mappings + its user memberships in
    // one transaction, then busts both caches (role -> rules for this role, and
    // the whole user -> roles cache, since the cascade changed many users).
    await roleMembershipStore.deleteRole({ roleId: id });
  });

  const updateUserRoles = os.updateUserRoles.handler(
    async ({ input, context }) => {
      const { userId, roles } = input;

      const currentUserId = isRealUser(context.user)
        ? context.user.id
        : undefined;
      if (userId === currentUserId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Cannot update your own roles",
        });
      }

      // Prevent assignment of the "anonymous" role - it's reserved for unauthenticated users
      if (roles.includes(ANONYMOUS_ROLE_ID)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The 'anonymous' role cannot be assigned to users",
        });
      }

      // The store replaces the user's roles and busts the cached user -> roles
      // entry.
      await roleMembershipStore.setUserRoles({ userId, roleIds: roles });
    },
  );

  const getStrategies = os.getStrategies.handler(async () => {
    const registeredStrategies = strategyRegistry.getStrategies();

    return Promise.all(
      registeredStrategies.map(async (strategy) => {
        // Get redacted config from ConfigService
        const config = await configService.getRedacted(
          strategy.id,
          strategy.configSchema,
          strategy.configVersion,
          strategy.migrations,
        );

        // Convert Zod schema to JSON Schema with automatic secret metadata
        const jsonSchema = toJsonSchema(strategy.configSchema);

        // Get enabled state from meta config
        const enabled = await getStrategyEnabled(strategy.id, configService);

        return {
          id: strategy.id,
          displayName: strategy.displayName,
          description: strategy.description,
          icon: strategy.icon,
          enabled,
          configVersion: strategy.configVersion,
          configSchema: jsonSchema,
          config,
          adminInstructions: strategy.adminInstructions,
        };
      }),
    );
  });

  const updateStrategy = os.updateStrategy.handler(async ({ input }) => {
    const { id, enabled, config } = input;
    const strategy = strategyRegistry.getStrategies().find((s) => s.id === id);

    if (!strategy) {
      throw new ORPCError("NOT_FOUND", {
        message: `Strategy ${id} not found`,
      });
    }

    // Save strategy configuration (if provided)
    if (config) {
      await configService.set(
        id,
        strategy.configSchema,
        strategy.configVersion,
        config, // Just the config, no enabled mixed in
        strategy.migrations,
      );
    }

    // Save enabled state separately in meta config
    await setStrategyEnabled(id, enabled, configService);

    // Trigger auth reload
    await reloadAuthFn();

    return { success: true };
  });

  const reloadAuth = os.reloadAuth.handler(async () => {
    await reloadAuthFn();
    return { success: true };
  });

  const getRegistrationSchema = os.getRegistrationSchema.handler(() => {
    return toJsonSchema(platformRegistrationConfigV1);
  });

  const getRegistrationStatus = os.getRegistrationStatus.handler(async () => {
    const allowRegistration = await isRegistrationAllowed(configService);
    return { allowRegistration };
  });

  const setRegistrationStatus = os.setRegistrationStatus.handler(
    async ({ input }) => {
      await configService.set(
        PLATFORM_REGISTRATION_CONFIG_ID,
        platformRegistrationConfigV1,
        PLATFORM_REGISTRATION_CONFIG_VERSION,
        { allowRegistration: input.allowRegistration },
      );
      // Trigger auth reload to apply new settings
      await reloadAuthFn();
      return { success: true };
    },
  );

  const getMcpOAuthSettings = os.getMcpOAuthSettings.handler(async () => {
    const cfg = await configService.get(
      MCP_OAUTH_CONFIG_ID,
      mcpOAuthConfigV1,
      MCP_OAUTH_CONFIG_VERSION,
    );
    // Defaults mirror the schema (off by default).
    return {
      enabled: cfg?.enabled ?? false,
      allowDynamicClientRegistration:
        cfg?.allowDynamicClientRegistration ?? false,
      dcrRateLimitMax: cfg?.dcrRateLimitMax ?? 5,
      dcrRateLimitWindowSeconds: cfg?.dcrRateLimitWindowSeconds ?? 3600,
    };
  });

  const setMcpOAuthSettings = os.setMcpOAuthSettings.handler(
    async ({ input }) => {
      await configService.set(
        MCP_OAUTH_CONFIG_ID,
        mcpOAuthConfigV1,
        MCP_OAUTH_CONFIG_VERSION,
        {
          enabled: input.enabled,
          allowDynamicClientRegistration: input.allowDynamicClientRegistration,
          dcrRateLimitMax: input.dcrRateLimitMax,
          dcrRateLimitWindowSeconds: input.dcrRateLimitWindowSeconds,
        },
      );
      // Enabling/disabling the plugins requires re-initializing better-auth.
      await reloadAuthFn();
      return { success: true };
    },
  );

  // ==========================================================================
  // ONBOARDING ENDPOINTS
  // ==========================================================================

  const validateResetToken = os.validateResetToken.handler(
    async ({ input }) => {
      const [record] = await internalDb
        .select({ expiresAt: schema.verification.expiresAt })
        .from(schema.verification)
        .where(
          eq(schema.verification.identifier, `reset-password:${input.token}`),
        )
        .limit(1);

      if (!record) {
        return { valid: false, reason: "invalid" as const };
      }
      if (record.expiresAt.getTime() <= Date.now()) {
        return { valid: false, reason: "expired" as const };
      }
      return { valid: true };
    },
  );

  const getOnboardingStatus = os.getOnboardingStatus.handler(async () => {
    // Check if any users exist in the database
    const users = await internalDb
      .select({ id: schema.user.id })
      .from(schema.user)
      .limit(1);
    return { needsOnboarding: users.length === 0 };
  });

  const completeOnboarding = os.completeOnboarding.handler(
    async ({ input }) => {
      const { name, email, password } = input;

      // Validate password against platform's password schema BEFORE taking the
      // onboarding lock so a bad password fails fast without serializing.
      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: passwordValidation.error.issues
            .map((issue) => issue.message)
            .join(", "),
        });
      }

      // Hash outside the transaction (it is slow; nothing depends on the lock).
      const userId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const hashedPassword = await hashPassword(password);
      const now = new Date();

      await internalDb.transaction(async (tx) => {
        // TOCTOU guard: take a transaction-scoped advisory lock so two
        // concurrent first-run calls cannot both pass the "no users" check and
        // both create an admin. The lock serializes onboarding attempts; it is
        // released automatically when the transaction ends. The `existingUsers`
        // re-check now runs INSIDE the locked transaction, so the second caller
        // observes the first caller's committed admin and is rejected. The lock
        // key is an arbitrary fixed constant scoped to onboarding.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(4242042)`);

        // Security check: only allow if no users exist (re-checked under lock).
        const existingUsers = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .limit(1);

        if (existingUsers.length > 0) {
          throw new ORPCError("FORBIDDEN", {
            message: "Onboarding has already been completed.",
          });
        }

        // Create user
        await tx.insert(schema.user).values({
          id: userId,
          email,
          name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        });

        // Create credential account
        await tx.insert(schema.account).values({
          id: accountId,
          accountId: email,
          providerId: "credential",
          userId,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        });

        // Assign admin role (via the store; a just-created user cannot be
        // cached yet, so no invalidation).
        await roleMembershipStore.grantInitialRoles({
          runner: tx,
          userId,
          roleIds: [ADMIN_ROLE_ID],
        });
      });

      return { success: true };
    },
  );

  // ==========================================================================
  // USER PROFILE ENDPOINTS
  // ==========================================================================

  const getCurrentUserProfile = os.getCurrentUserProfile.handler(
    async ({ context }) => {
      const user = context.user;
      if (!isRealUser(user)) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Not authenticated",
        });
      }

      // Get user data
      const users = await internalDb
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, user.id))
        .limit(1);

      if (users.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "User not found",
        });
      }

      // Check if user has a credential account
      const accounts = await internalDb
        .select()
        .from(schema.account)
        .where(
          and(
            eq(schema.account.userId, user.id),
            eq(schema.account.providerId, "credential"),
          ),
        )
        .limit(1);

      return {
        id: users[0].id,
        name: users[0].name,
        email: users[0].email,
        hasCredentialAccount: accounts.length > 0,
      };
    },
  );

  const updateCurrentUser = os.updateCurrentUser.handler(
    async ({ input, context }) => {
      const user = context.user;
      if (!isRealUser(user)) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Not authenticated",
        });
      }

      const { name, email } = input;

      // If email is being updated, check if user has a credential account
      if (email !== undefined) {
        const accounts = await internalDb
          .select()
          .from(schema.account)
          .where(
            and(
              eq(schema.account.userId, user.id),
              eq(schema.account.providerId, "credential"),
            ),
          )
          .limit(1);

        if (accounts.length === 0) {
          throw new ORPCError("FORBIDDEN", {
            message: "Email can only be updated for credential-based accounts.",
          });
        }

        // Check email uniqueness
        const existingUsers = await internalDb
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, email))
          .limit(1);

        if (existingUsers.length > 0 && existingUsers[0].id !== user.id) {
          throw new ORPCError("CONFLICT", {
            message: "A user with this email already exists.",
          });
        }
      }

      // Build update object
      const updates: { name?: string; email?: string; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;

      await internalDb
        .update(schema.user)
        .set(updates)
        .where(eq(schema.user.id, user.id));

      // If email was updated, also update the credential account's accountId
      if (email !== undefined) {
        await internalDb
          .update(schema.account)
          .set({ accountId: email, updatedAt: new Date() })
          .where(
            and(
              eq(schema.account.userId, user.id),
              eq(schema.account.providerId, "credential"),
            ),
          );
      }
    },
  );

  const getAnonymousAccessRules = os.getAnonymousAccessRules.handler(
    async () => loadAnonymousAccessRules(),
  );

  const filterUsersByAccessRule = os.filterUsersByAccessRule.handler(
    async ({ input }) => {
      const { userIds, accessRule } = input;

      if (userIds.length === 0) return [];

      // Single efficient query: join user_role with role_access_rule
      // and filter by both userIds AND the specific access rule
      const usersWithAccess = await internalDb
        .select({ userId: schema.userRole.userId })
        .from(schema.userRole)
        .innerJoin(
          schema.roleAccessRule,
          eq(schema.userRole.roleId, schema.roleAccessRule.roleId),
        )
        .where(
          and(
            inArray(schema.userRole.userId, userIds),
            eq(schema.roleAccessRule.accessRuleId, accessRule),
          ),
        )
        .groupBy(schema.userRole.userId);

      return usersWithAccess.map((row) => row.userId);
    },
  );

  // ==========================================================================
  // SERVICE-TO-SERVICE ENDPOINTS (for external auth providers like LDAP)
  // ==========================================================================

  const getUserById = os.getUserById.handler(async ({ input }) => {
    const users = await internalDb
      .select({
        id: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
      })
      .from(schema.user)
      .where(eq(schema.user.id, input.userId))
      .limit(1);

    return users.length > 0 ? users[0] : undefined;
  });

  const findUserByEmail = os.findUserByEmail.handler(async ({ input }) => {
    const users = await internalDb
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, input.email))
      .limit(1);

    return users.length > 0 ? { id: users[0].id } : undefined;
  });

  const upsertExternalUser = os.upsertExternalUser.handler(
    async ({ input, context }) => {
      const {
        email,
        name,
        providerId,
        accountId,
        password,
        autoUpdateUser,
        syncRoles,
        managedRoleIds,
      } = input;

      // Check if user exists
      const existingUsers = await internalDb
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);

      let userId: string;
      let created = false;

      if (existingUsers.length > 0) {
        // User exists - update if autoUpdateUser is enabled
        userId = existingUsers[0].id;

        if (autoUpdateUser) {
          await internalDb
            .update(schema.user)
            .set({ name, updatedAt: new Date() })
            .where(eq(schema.user.id, userId));
        }
      } else {
        // Check if registration is allowed before creating new user
        const registrationAllowed = await isRegistrationAllowed(configService);
        if (!registrationAllowed) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "Registration is disabled. Please contact an administrator.",
          });
        }

        // Create new user and account in a transaction
        userId = crypto.randomUUID();
        const accountEntryId = crypto.randomUUID();
        const now = new Date();

        await internalDb.transaction(async (tx) => {
          // Create user
          await tx.insert(schema.user).values({
            id: userId,
            email,
            name,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          });

          // Create account
          await tx.insert(schema.account).values({
            id: accountEntryId,
            accountId,
            providerId,
            userId,
            password,
            createdAt: now,
            updatedAt: now,
          });
        });

        context.logger.info(`Created new user from ${providerId}: ${email}`);
        created = true;
      }

      // Handle role sync if syncRoles is provided
      // Uses managedRoleIds to determine which roles are controlled by directory
      if (syncRoles) {
        const syncRoleSet = new Set(syncRoles);

        // Validate which sync roles actually exist in the database
        const validSyncRoles =
          syncRoles.length > 0
            ? await internalDb
                .select({ id: schema.role.id })
                .from(schema.role)
                .where(inArray(schema.role.id, syncRoles))
            : [];
        const validSyncRoleIds = new Set(validSyncRoles.map((r) => r.id));

        // Get current user roles
        const currentRoles = await internalDb
          .select({ roleId: schema.userRole.roleId })
          .from(schema.userRole)
          .where(eq(schema.userRole.userId, userId));
        const currentRoleIds = new Set(currentRoles.map((r) => r.roleId));

        // Add new roles that user should have
        const rolesToAdd = [...validSyncRoleIds].filter(
          (id) => !currentRoleIds.has(id),
        );

        // Remove roles that are managed but user no longer has in directory:
        // currently has + is managed + NOT in sync roles.
        const rolesToRemove =
          managedRoleIds && managedRoleIds.length > 0
            ? [...currentRoleIds].filter(
                (id) => managedRoleIds.includes(id) && !syncRoleSet.has(id),
              )
            : [];

        if (rolesToAdd.length > 0) {
          context.logger.info(
            `Added ${rolesToAdd.length} roles for external user: ${email}`,
          );
        }
        if (rolesToRemove.length > 0) {
          context.logger.info(
            `Removed ${rolesToRemove.length} managed roles for external user: ${email}`,
          );
        }

        // The store applies the add/remove in one transaction and, only when
        // something actually changed (this runs on every external login), busts
        // the cached user -> roles entry.
        await roleMembershipStore.syncUserRoles({
          userId,
          addRoleIds: rolesToAdd,
          removeRoleIds: rolesToRemove,
        });
      }

      return { userId, created };
    },
  );

  const createSession = os.createSession.handler(async ({ input }) => {
    const { userId, ipAddress, userAgent } = input;
    const auth = getBetterAuth();

    if (!auth) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Authentication service not fully initialized.",
      });
    }

    // Construct virtual request to the internal trusted login endpoint
    // This allows better-auth to handle cookie signing and database persistence
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "BASE_URL environment variable is not defined.",
      });
    }

    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "BETTER_AUTH_SECRET environment variable is not defined.",
      });
    }

    const url = new URL(baseUrl);
    const req = new Request(`${url.origin}/api/auth/internal/trusted-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-checkstack-internal": secret,
        "x-forwarded-for": ipAddress || "",
        "user-agent": userAgent || "",
        Host: url.host,
      },
      body: JSON.stringify({ userId }),
    });

    const res = await auth.handler(req);

    if (!res.ok) {
      const errorText = await res.text();
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Failed to create session via bridge: ${res.status} ${errorText}`,
      });
    }

    // Extract Set-Cookie headers as individual strings (one per cookie)
    // Using getSetCookie() preserves each cookie separately — joining with commas
    // corrupts cookie attributes that contain commas (e.g. Expires dates)
    const setCookies = res.headers.getSetCookie();

    if (setCookies.length === 0) {
      const headers: Record<string, string> = {};
      // eslint-disable-next-line unicorn/no-array-for-each
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      logger.error("Authentication bridge did not return session cookies", {
        status: res.status,
        headers,
      });
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Authentication service did not return session cookies.",
      });
    }

    const body = (await res.json()) as { sessionId: string };

    return {
      sessionId: body.sessionId,
      setCookies,
    };
  });

  // ==========================================================================
  // ADMIN USER CREATION (bypasses registration check)
  // ==========================================================================

  const createCredentialUser = os.createCredentialUser.handler(
    async ({ input, context }) => {
      const { email, name, password } = input;

      // Validate password against platform's password schema
      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: passwordValidation.error.issues
            .map((issue) => issue.message)
            .join(", "),
        });
      }

      // Check if credential strategy is enabled
      const credentialEnabled = await getStrategyEnabled(
        "credential",
        configService,
      );
      if (!credentialEnabled) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Credential strategy is not enabled. Enable it in Authentication Settings first.",
        });
      }

      // Check if user already exists
      const existingUsers = await internalDb
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);

      if (existingUsers.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: "A user with this email already exists.",
        });
      }

      // Create user directly in database (bypasses registration check)
      const userId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const hashedPassword = await hashPassword(password);
      const now = new Date();

      await internalDb.transaction(async (tx) => {
        // Create user
        await tx.insert(schema.user).values({
          id: userId,
          email,
          name,
          emailVerified: true, // Admin-created users are pre-verified
          createdAt: now,
          updatedAt: now,
        });

        // Create credential account
        await tx.insert(schema.account).values({
          id: accountId,
          accountId: email,
          providerId: "credential",
          userId,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        });

        // Assign "users" role to new user (via the store; a just-created user
        // cannot be cached yet, so no invalidation).
        await roleMembershipStore.grantInitialRoles({
          runner: tx,
          userId,
          roleIds: [USERS_ROLE_ID],
        });
      });

      context.logger.info(
        `[auth-backend] Admin created credential user: ${email}`,
      );

      return { userId };
    },
  );

  // ==========================================================================
  // APPLICATION MANAGEMENT
  // External applications (API keys) with RBAC integration
  // ==========================================================================

  const getApplications = os.getApplications.handler(async () => {
    const apps = await internalDb.select().from(schema.application);
    if (apps.length === 0) return [];

    const appRoles = await internalDb
      .select()
      .from(schema.applicationRole)
      .where(
        inArray(
          schema.applicationRole.applicationId,
          apps.map((a) => a.id),
        ),
      );

    return apps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      roles: appRoles
        .filter((ar) => ar.applicationId === app.id)
        .map((ar) => ar.roleId),
      createdById: app.createdById,
      createdAt: app.createdAt,
      lastUsedAt: app.lastUsedAt,
    }));
  });

  const createApplication = os.createApplication.handler(
    async ({ input, context }) => {
      const { name, description } = input;

      const userId = isRealUser(context.user) ? context.user.id : undefined;
      if (!userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User ID required to create application",
        });
      }

      const id = crypto.randomUUID();
      const secret = generateSecret();
      // Hash with bcrypt via better-auth's hashPassword
      const secretHash = await hashPassword(secret);
      const now = new Date();

      // Default role for all applications
      const defaultRole = APPLICATIONS_ROLE_ID;

      await internalDb.transaction(async (tx) => {
        // Create application
        await tx.insert(schema.application).values({
          id,
          name,
          description: description ?? undefined,
          secretHash,
          createdById: userId,
          createdAt: now,
          updatedAt: now,
        });

        // Assign default "applications" role
        await tx.insert(schema.applicationRole).values({
          applicationId: id,
          roleId: defaultRole,
        });
      });

      context.logger.info(
        `[auth-backend] Created application: ${name} (${id})`,
      );

      return {
        application: {
          id,
          name,
          description: description ?? undefined,
          roles: [defaultRole],
          createdById: userId,
          createdAt: now,
        },
        secret: `ck_${id}_${secret}`, // Full secret - only shown once!
      };
    },
  );

  const updateApplication = os.updateApplication.handler(async ({ input }) => {
    const { id, name, description, roles } = input;

    // Check if application exists
    const existing = await internalDb
      .select()
      .from(schema.application)
      .where(eq(schema.application.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: `Application ${id} not found`,
      });
    }

    await internalDb.transaction(async (tx) => {
      // Update application fields
      const updates: {
        name?: string;
        description?: string | null;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;

      await tx
        .update(schema.application)
        .set(updates)
        .where(eq(schema.application.id, id));

      // Update roles if provided
      if (roles !== undefined) {
        // Delete existing role mappings
        await tx
          .delete(schema.applicationRole)
          .where(eq(schema.applicationRole.applicationId, id));

        // Insert new role mappings
        if (roles.length > 0) {
          await tx.insert(schema.applicationRole).values(
            roles.map((roleId) => ({
              applicationId: id,
              roleId,
            })),
          );
        }
      }
    });
  });

  const deleteApplication = os.deleteApplication.handler(
    async ({ input: id, context }) => {
      // Check if application exists
      const existing = await internalDb
        .select()
        .from(schema.application)
        .where(eq(schema.application.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: `Application ${id} not found`,
        });
      }

      // Cascade delete is handled by FK constraint on applicationRole
      // Just delete the application
      await internalDb
        .delete(schema.application)
        .where(eq(schema.application.id, id));

      context.logger.info(`[auth-backend] Deleted application: ${id}`);
    },
  );

  const regenerateApplicationSecret = os.regenerateApplicationSecret.handler(
    async ({ input: id, context }) => {
      // Check if application exists
      const existing = await internalDb
        .select()
        .from(schema.application)
        .where(eq(schema.application.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: `Application ${id} not found`,
        });
      }

      const secret = generateSecret();
      const secretHash = await hashPassword(secret);

      await internalDb
        .update(schema.application)
        .set({ secretHash, updatedAt: new Date() })
        .where(eq(schema.application.id, id));

      context.logger.info(
        `[auth-backend] Regenerated secret for application: ${id}`,
      );

      return { secret: `ck_${id}_${secret}` };
    },
  );

  // S2S: resolve an application principal live for the app-principal token path.
  const enrichApplicationPrincipal =
    os.enrichApplicationPrincipal.handler(async ({ input }) => {
      const enriched = await resolveApplicationPrincipal(
        input.applicationId,
        internalDb,
      );
      return enriched ?? null;
    });

  // List applications the caller may bind as an automation's service account.
  // An app is bindable only when its access rules are a subset of the caller's
  // (no privilege escalation); `*`-holders may bind anything.
  const getBindableApplications = os.getBindableApplications.handler(
    async ({ input, context }) => {
      // The picker (UI) only needs id/name/description; the AI propose /
      // service-account flow needs each app's effective rules to match against
      // an action's `requiredAccessRules`, and opts in via `includeAccessRules`.
      const includeAccessRules = input?.includeAccessRules ?? false;
      const callerRules = isRealUser(context.user)
        ? (context.user.accessRules ?? [])
        : [];
      const callerIsAdmin = callerRules.includes("*");

      const apps = await internalDb.select().from(schema.application);

      // Fast path: a `*` caller may bind every application, and when the caller
      // did not ask for the apps' rules we can skip rule resolution entirely.
      // This keeps the editor's "Run as" picker a single query for admins (the
      // common case) instead of resolving every application on every open.
      if (callerIsAdmin && !includeAccessRules) {
        return apps.map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
        }));
      }

      // Otherwise resolve every application's rules in a fixed number of queries
      // (not one query per app) — needed for the non-admin subset check and/or
      // to return `accessRules` when requested.
      const rulesByApp = await resolveAllApplicationAccessRules(internalDb);

      const bindable: {
        id: string;
        name: string;
        description: string | null;
        accessRules?: string[];
      }[] = [];

      for (const app of apps) {
        const appRules = rulesByApp.get(app.id) ?? [];
        if (
          !callerIsAdmin &&
          !isApplicationBindable({
            appAccessRules: appRules,
            callerAccessRules: callerRules,
          })
        ) {
          continue;
        }
        bindable.push({
          id: app.id,
          name: app.name,
          description: app.description,
          ...(includeAccessRules ? { accessRules: appRules } : {}),
        });
      }

      return bindable;
    },
  );

  // ==========================================================================
  // TEAM MANAGEMENT HANDLERS
  // ==========================================================================

  // --- Team-scoped read authorization ---------------------------------------
  // The team read / self-service surfaces (the Teams page, the "Who can change
  // this" editor) are reached by team MEMBERS and MANAGERS, who hold a per-team
  // ReBAC grant, NOT the global `teams.read` rule. Those procedures are therefore
  // gated `access: []` in the contract (so the middleware doesn't 403 a team
  // manager) and scoped HERE: a global `teams.read` holder - or a trusted service
  // - sees everything; everyone else sees only the team(s) they belong to as a
  // member or manager. WRITE procedures keep enforcing `assertTeamManagementAccess`.
  //
  // `hasGlobalTeamsRead` is a module-scope helper (see above); the two below
  // close over `internalDb` so they stay local.

  /** Team ids the caller belongs to as a MEMBER or a MANAGER (managers are not
   * necessarily members). Empty for anonymous callers. */
  const scopedTeamIdsFor = async (
    user: AuthUser | undefined,
  ): Promise<Set<string>> => {
    if (user?.type === "application" && user.id) {
      const rows = await internalDb
        .select({ teamId: schema.applicationTeam.teamId })
        .from(schema.applicationTeam)
        .where(eq(schema.applicationTeam.applicationId, user.id));
      return new Set(rows.map((r) => r.teamId));
    }
    if (!isRealUser(user)) return new Set();
    const [memberRows, managerRows] = await Promise.all([
      internalDb
        .select({ teamId: schema.userTeam.teamId })
        .from(schema.userTeam)
        .where(eq(schema.userTeam.userId, user.id)),
      internalDb
        .select({ teamId: schema.teamManager.teamId })
        .from(schema.teamManager)
        .where(eq(schema.teamManager.userId, user.id)),
    ]);
    return new Set([
      ...memberRows.map((r) => r.teamId),
      ...managerRows.map((r) => r.teamId),
    ]);
  };

  /** Throw FORBIDDEN unless the caller may read the given team (global read, a
   * service, or a member/manager of it). */
  const assertTeamVisible = async (
    user: AuthUser | undefined,
    teamId: string,
  ): Promise<void> => {
    if (hasGlobalTeamsRead(user)) return;
    const scope = await scopedTeamIdsFor(user);
    if (!scope.has(teamId)) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have access to this team.",
      });
    }
  };

  const getTeams = os.getTeams.handler(async ({ context }) => {
    const teams = await internalDb.select().from(schema.team);
    const memberCounts = await internalDb
      .select({ teamId: schema.userTeam.teamId })
      .from(schema.userTeam);

    const userId = isRealUser(context.user) ? context.user.id : undefined;
    const managerRows = userId
      ? await internalDb
          .select()
          .from(schema.teamManager)
          .where(eq(schema.teamManager.userId, userId))
      : [];
    const managedTeamIds = new Set(managerRows.map((m) => m.teamId));

    // Scope: everyone without global read sees ONLY their own team(s).
    const globalRead = hasGlobalTeamsRead(context.user);
    const scope = globalRead ? null : await scopedTeamIdsFor(context.user);
    const visibleTeams = globalRead
      ? teams
      : teams.filter((t) => scope!.has(t.id));

    return visibleTeams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberCount: memberCounts.filter((m) => m.teamId === t.id).length,
      isManager: managedTeamIds.has(t.id),
    }));
  });

  const getTeam = os.getTeam.handler(async ({ input, context }) => {
    // Scope: only a global-read holder / service or a member/manager of THIS
    // team may read it. Return undefined otherwise (no existence leak).
    if (!hasGlobalTeamsRead(context.user)) {
      const scope = await scopedTeamIdsFor(context.user);
      if (!scope.has(input.teamId)) return;
    }
    const teams = await internalDb
      .select()
      .from(schema.team)
      .where(eq(schema.team.id, input.teamId))
      .limit(1);
    if (teams.length === 0) return;

    const team = teams[0];
    const memberRows = await internalDb
      .select({ userId: schema.userTeam.userId })
      .from(schema.userTeam)
      .where(eq(schema.userTeam.teamId, team.id));
    const managerRows = await internalDb
      .select({ userId: schema.teamManager.userId })
      .from(schema.teamManager)
      .where(eq(schema.teamManager.teamId, team.id));

    const userIds = [
      ...new Set([
        ...memberRows.map((m) => m.userId),
        ...managerRows.map((m) => m.userId),
      ]),
    ];
    const users =
      userIds.length > 0
        ? await internalDb
            .select({
              id: schema.user.id,
              name: schema.user.name,
              email: schema.user.email,
            })
            .from(schema.user)
            .where(inArray(schema.user.id, userIds))
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      members: memberRows
        .map((m) => userMap.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => u !== undefined),
      managers: managerRows
        .map((m) => userMap.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => u !== undefined),
    };
  });

  const createTeam = os.createTeam.handler(async ({ input, context }) => {
    const id = crypto.randomUUID();
    const now = new Date();
    await internalDb.insert(schema.team).values({
      id,
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    });
    context.logger.info(`[auth-backend] Created team: ${input.name}`);
    return { id };
  });

  const updateTeam = os.updateTeam.handler(async ({ input, context }) => {
    const { id, name, description } = input;

    await assertTeamManagementAccess({
      user: context.user,
      teamId: id,
      internalDb,
    });

    const updates: {
      name?: string;
      description?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    await internalDb
      .update(schema.team)
      .set(updates)
      .where(eq(schema.team.id, id));
    context.logger.info(`[auth-backend] Updated team: ${id}`);
  });

  const deleteTeam = os.deleteTeam.handler(async ({ input: id, context }) => {
    await assertTeamManagementAccess({
      user: context.user,
      teamId: id,
      internalDb,
    });
    await internalDb.transaction(async (tx) => {
      await tx.delete(schema.userTeam).where(eq(schema.userTeam.teamId, id));
      await tx
        .delete(schema.teamManager)
        .where(eq(schema.teamManager.teamId, id));
      await tx
        .delete(schema.applicationTeam)
        .where(eq(schema.applicationTeam.teamId, id));
      // relation_tuple has no FK (polymorphic subject), so its rows for this
      // team must be cleared explicitly (this also removes the team's grants +
      // create-capability tuples).
      await tx
        .delete(schema.relationTuple)
        .where(
          and(
            eq(schema.relationTuple.subjectType, "team"),
            eq(schema.relationTuple.subjectId, id),
          ),
        );
      await tx.delete(schema.team).where(eq(schema.team.id, id));
    });
    context.logger.info(`[auth-backend] Deleted team: ${id}`);
  });

  const addUserToTeam = os.addUserToTeam.handler(async ({ input, context }) => {
    await assertTeamManagementAccess({
      user: context.user,
      teamId: input.teamId,
      internalDb,
    });
    await internalDb
      .insert(schema.userTeam)
      .values({ userId: input.userId, teamId: input.teamId })
      .onConflictDoNothing();
  });

  const removeUserFromTeam = os.removeUserFromTeam.handler(
    async ({ input, context }) => {
      await assertTeamManagementAccess({
        user: context.user,
        teamId: input.teamId,
        internalDb,
      });
      await internalDb
        .delete(schema.userTeam)
        .where(
          and(
            eq(schema.userTeam.userId, input.userId),
            eq(schema.userTeam.teamId, input.teamId),
          ),
        );
    },
  );

  const addTeamManager = os.addTeamManager.handler(
    async ({ input, context }) => {
      await assertTeamManagementAccess({
        user: context.user,
        teamId: input.teamId,
        internalDb,
      });
      await internalDb
        .insert(schema.teamManager)
        .values({ userId: input.userId, teamId: input.teamId })
        .onConflictDoNothing();
    },
  );

  const removeTeamManager = os.removeTeamManager.handler(
    async ({ input, context }) => {
      await assertTeamManagementAccess({
        user: context.user,
        teamId: input.teamId,
        internalDb,
      });
      await internalDb
        .delete(schema.teamManager)
        .where(
          and(
            eq(schema.teamManager.userId, input.userId),
            eq(schema.teamManager.teamId, input.teamId),
          ),
        );
    },
  );

  // The single ReBAC store (relation tuples) backing the whole access layer.
  const tupleStore = new RelationTupleStore(internalDb);

  // Resolve a principal's team ids (users and applications use distinct tables).
  const resolveUserTeamIds = async (
    userId: string,
    userType: "user" | "application",
  ): Promise<string[]> => {
    const isUser = userType === "user";
    const teamTable = isUser ? schema.userTeam : schema.applicationTeam;
    const idCol = isUser
      ? schema.userTeam.userId
      : schema.applicationTeam.applicationId;
    const teamIdCol = isUser
      ? schema.userTeam.teamId
      : schema.applicationTeam.teamId;
    const rows = await internalDb
      .select({ teamId: teamIdCol })
      .from(teamTable)
      .where(eq(idCol, userId));
    return rows.map((r) => r.teamId);
  };

  // Reject grants for a resource type no plugin registers. The kinds come from
  // the contracts (`getResourceKinds`), so this catches typos and junk types
  // that would create inert "phantom" tuples. When the registry is unavailable
  // (e.g. unit tests), validation is skipped rather than failing closed.
  const assertKnownResourceType = (resourceType: string) => {
    const kinds = accessRuleRegistry.getResourceKinds?.();
    if (!kinds) return;
    if (!kinds.some((k) => k.resourceType === resourceType)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Unknown resource type "${resourceType}". It is not registered by any installed plugin.`,
      });
    }
  };

  // Who has access to an object + whether it is public (the privacy marker).
  const listObjectRelations = os.listObjectRelations.handler(
    async ({ input, context }) => {
      const { teams, isPublic } = await tupleStore.listObjectRelations({
        objectType: input.objectType,
        objectId: input.objectId,
      });
      if (teams.length === 0) return { teams: [], isPublic };
      // Scope: a global teams.read holder sees every grant; otherwise the caller
      // must have a STAKE - be a member/manager of a team granted on this object
      // - so an unrelated user can't enumerate a resource's team access. The
      // public flag is always returned.
      if (!hasGlobalTeamsRead(context.user)) {
        const scope = await scopedTeamIdsFor(context.user);
        if (!teams.some((t) => scope.has(t.teamId))) {
          return { teams: [], isPublic };
        }
      }
      const nameRows = await internalDb
        .select({ id: schema.team.id, name: schema.team.name })
        .from(schema.team)
        .where(
          inArray(
            schema.team.id,
            teams.map((t) => t.teamId),
          ),
        );
      const nameById = new Map(nameRows.map((r) => [r.id, r.name]));
      return {
        teams: teams.map((t) => ({
          teamId: t.teamId,
          teamName: nameById.get(t.teamId) ?? t.teamId,
          relation: asRelation(t.relation),
        })),
        isPublic,
      };
    },
  );

  const listObjectRelationsBulk = os.listObjectRelationsBulk.handler(
    async ({ input, context }) => {
      if (input.objectIds.length === 0) return { objects: [] };
      const rawResults = await tupleStore.listObjectRelationsBulk({
        objectType: input.objectType,
        objectIds: input.objectIds,
      });
      // Scope (same STAKE rule as listObjectRelations, applied per object): a
      // global teams.read holder sees every grant; otherwise an object's team
      // grants are hidden unless the caller is a member/manager of one of them.
      const scope = hasGlobalTeamsRead(context.user)
        ? null
        : await scopedTeamIdsFor(context.user);
      const results = scope
        ? rawResults.map((r) =>
            r.teams.some((t) => scope.has(t.teamId))
              ? r
              : { ...r, teams: [] },
          )
        : rawResults;
      // Resolve every referenced team name in ONE query across all objects.
      const allTeamIds = [
        ...new Set(results.flatMap((r) => r.teams.map((t) => t.teamId))),
      ];
      const nameById = new Map<string, string>();
      if (allTeamIds.length > 0) {
        const nameRows = await internalDb
          .select({ id: schema.team.id, name: schema.team.name })
          .from(schema.team)
          .where(inArray(schema.team.id, allTeamIds));
        for (const r of nameRows) nameById.set(r.id, r.name);
      }
      return {
        objects: results.map((r) => ({
          objectId: r.objectId,
          teams: r.teams.map((t) => ({
            teamId: t.teamId,
            teamName: nameById.get(t.teamId) ?? t.teamId,
            relation: asRelation(t.relation),
          })),
          isPublic: r.isPublic,
        })),
      };
    },
  );

  const writeRelation = os.writeRelation.handler(async ({ input }) => {
    assertKnownResourceType(input.objectType);
    await tupleStore.setTeamRelation({
      objectType: input.objectType,
      objectId: input.objectId,
      teamId: input.teamId,
      relation: input.relation,
    });
  });

  const removeRelation = os.removeRelation.handler(async ({ input }) => {
    await tupleStore.removeTeamFromObject({
      objectType: input.objectType,
      objectId: input.objectId,
      teamId: input.teamId,
    });
  });

  const setObjectPublic = os.setObjectPublic.handler(async ({ input }) => {
    assertKnownResourceType(input.objectType);
    await tupleStore.setObjectPublic({
      objectType: input.objectType,
      objectId: input.objectId,
      isPublic: input.isPublic,
    });
  });

  // S2S engine endpoints (called by the auth middleware).
  const check = os.check.handler(async ({ input }) => {
    const userTeamIds = await resolveUserTeamIds(input.userId, input.userType);
    const hasAccess = await tupleStore.check({
      objectType: input.objectType,
      objectId: input.objectId,
      userTeamIds,
      action: input.action,
      hasGlobalAccess: input.hasGlobalAccess,
    });
    return { hasAccess };
  });

  const listAccessibleObjectIds = os.listAccessibleObjectIds.handler(
    async ({ input }) => {
      if (input.objectIds.length === 0) return [];
      const userTeamIds = await resolveUserTeamIds(
        input.userId,
        input.userType,
      );
      return tupleStore.listAccessibleObjectIds({
        objectType: input.objectType,
        candidateIds: input.objectIds,
        userTeamIds,
        action: input.action,
        hasGlobalAccess: input.hasGlobalAccess,
      });
    },
  );

  const deleteObjectRelations = os.deleteObjectRelations.handler(
    async ({ input }) => {
      await internalDb
        .delete(schema.relationTuple)
        .where(
          and(
            eq(schema.relationTuple.objectType, input.objectType),
            eq(schema.relationTuple.objectId, input.objectId),
          ),
        );
    },
  );

  const hasAnyTypeGrant = os.hasAnyTypeGrant.handler(async ({ input }) => {
    const userTeamIds = await resolveUserTeamIds(input.userId, input.userType);
    if (userTeamIds.length === 0) return { hasGrant: false };
    const hasGrant = await tupleStore.hasAnyTypeGrant({
      objectType: input.objectType,
      userTeamIds,
      action: input.action,
      includeCreator: input.includeCreator,
    });
    return { hasGrant };
  });

  const getResourceKinds = os.getResourceKinds.handler(async () => {
    return { kinds: accessRuleRegistry.getResourceKinds?.() ?? [] };
  });

  // Resolve opaque grant resourceIds to display names via the owning plugin's
  // registered resolver. Unknown types/ids are simply omitted (the UI falls
  // back to the raw id). Resolver failures degrade to an empty map, never a 5xx.
  const resolveResourceNames = os.resolveResourceNames.handler(
    async ({ input }) => {
      const resolver = resourceResolverRegistry?.get(input.resourceType);
      if (!resolver || input.resourceIds.length === 0) return { names: {} };
      try {
        const map = await resolver.resolveNames(input.resourceIds);
        return { names: Object.fromEntries(map) };
      } catch (error) {
        logger.error(
          `resolveResourceNames failed for ${input.resourceType}: ${String(error)}`,
        );
        return { names: {} };
      }
    },
  );

  // Search an owning plugin's resources for the team-grant picker.
  const searchResources = os.searchResources.handler(async ({ input }) => {
    const resolver = resourceResolverRegistry?.get(input.resourceType);
    if (!resolver) return { results: [] };
    try {
      const results = await resolver.search(input.query, input.limit ?? 20);
      return { results };
    } catch (error) {
      logger.error(
        `searchResources failed for ${input.resourceType}: ${String(error)}`,
      );
      return { results: [] };
    }
  });

  const listSubjectRelations = os.listSubjectRelations.handler(
    async ({ input, context }) => {
      await assertTeamVisible(context.user, input.teamId);
      const rows = await tupleStore.listSubjectRelations({
        teamId: input.teamId,
      });
      return {
        grants: rows.map((r) => ({
          objectType: r.objectType,
          objectId: r.objectId,
          relation: asRelation(r.relation),
        })),
      };
    },
  );

  const getMyTeams = os.getMyTeams.handler(async ({ context }) => {
    const user = context.user;
    if (!user || (user.type !== "user" && user.type !== "application")) {
      return { teams: [] };
    }
    const isUser = user.type === "user";
    const teamTable = isUser ? schema.userTeam : schema.applicationTeam;
    const idCol = isUser
      ? schema.userTeam.userId
      : schema.applicationTeam.applicationId;
    const teamIdCol = isUser
      ? schema.userTeam.teamId
      : schema.applicationTeam.teamId;
    const rows = await internalDb
      .select({ id: schema.team.id, name: schema.team.name })
      .from(teamTable)
      .innerJoin(schema.team, eq(teamIdCol, schema.team.id))
      .where(eq(idCol, user.id));
    return { teams: rows };
  });

  const setCreateGrant = os.setCreateGrant.handler(async ({ input }) => {
    assertKnownResourceType(input.objectType);
    await tupleStore.setCreator({
      objectType: input.objectType,
      teamId: input.teamId,
      allowed: input.allowed,
    });
  });

  const getMyManagingTeams = os.getMyManagingTeams.handler(
    async ({ context, input }) => {
      const user = context.user;
      if (!user || (user.type !== "user" && user.type !== "application")) {
        return { teamIds: [] };
      }
      const resourceIds = [...new Set(input.resourceIds)];
      if (resourceIds.length === 0) return { teamIds: [] };

      const isUser = user.type === "user";
      const teamTable = isUser ? schema.userTeam : schema.applicationTeam;
      const idCol = isUser
        ? schema.userTeam.userId
        : schema.applicationTeam.applicationId;
      const teamIdCol = isUser
        ? schema.userTeam.teamId
        : schema.applicationTeam.teamId;
      const memberRows = await internalDb
        .select({ teamId: teamIdCol })
        .from(teamTable)
        .where(eq(idCol, user.id));
      const myTeamIds = memberRows.map((r) => r.teamId);
      if (myTeamIds.length === 0) return { teamIds: [] };

      // MANAGE relations (editor|owner) on these objects held by the caller's
      // teams. A team qualifies only if it manages EVERY requested object.
      const grants = await internalDb
        .select({
          teamId: schema.relationTuple.subjectId,
          objectId: schema.relationTuple.objectId,
        })
        .from(schema.relationTuple)
        .where(
          and(
            eq(schema.relationTuple.objectType, input.resourceType),
            inArray(schema.relationTuple.objectId, resourceIds),
            eq(schema.relationTuple.subjectType, "team"),
            inArray(schema.relationTuple.subjectId, myTeamIds),
            inArray(schema.relationTuple.relation, ["editor", "owner"]),
          ),
        );

      const byTeam = new Map<string, Set<string>>();
      for (const g of grants) {
        const set = byTeam.get(g.teamId) ?? new Set<string>();
        set.add(g.objectId);
        byTeam.set(g.teamId, set);
      }
      const teamIds = [...byTeam.entries()]
        .filter(([, set]) => set.size === resourceIds.length)
        .map(([teamId]) => teamId);
      return { teamIds };
    },
  );

  const listTeamCreateGrants = os.listTeamCreateGrants.handler(
    async ({ input, context }) => {
      await assertTeamVisible(context.user, input.teamId);
      const resourceTypes = await tupleStore.listCreateGrants({
        teamId: input.teamId,
      });
      return { resourceTypes };
    },
  );

  // The single definition of type-level create capability: does one of these
  // teams hold a `creator` grant on `objectType`? Consumed by the S2S
  // `hasCreateCapability` (which backs the `create.alsoAcceptCreatorOf` seam) and
  // by the frontend `canCreate` verdict, so both agree by construction.
  const teamsHoldCreatorGrant = async (
    objectType: string,
    userTeamIds: string[],
  ) => {
    const creatorTeamIds = await tupleStore.creatorTeamIds({
      objectType,
      userTeamIds,
    });
    return creatorTeamIds.length > 0;
  };

  // S2S: strictly the type-level `creator` capability for `objectType` (an
  // instance editor/owner grant does NOT count). Backs the middleware
  // `create.alsoAcceptCreatorOf` sibling gate.
  const hasCreateCapability = os.hasCreateCapability.handler(
    async ({ input }) => {
      const userTeamIds = await resolveUserTeamIds(
        input.userId,
        input.userType,
      );
      if (userTeamIds.length === 0) return { hasCapability: false };
      return {
        hasCapability: await teamsHoldCreatorGrant(
          input.objectType,
          userTeamIds,
        ),
      };
    },
  );

  // Frontend-facing mirror of the team-derived branch of `authorizeCreate`: does
  // the caller belong to a team that may create `objectType` — either via a
  // per-type `creator` grant (or a `creator` grant on any of `alsoAcceptCreatorOf`,
  // the sibling self-service seam), or (when `parentType` is given) by managing
  // at least one object of that parent type (the parent gate). The global-RBAC
  // path is intentionally NOT resolved here; the frontend ORs `useAccess(rule)`
  // with this. Anonymous callers and users with no teams get `false`.
  const canCreate = os.canCreate.handler(async ({ context, input }) => {
    const user = context.user;
    if (!user || (user.type !== "user" && user.type !== "application")) {
      return { allowed: false };
    }
    const userTeamIds = await resolveUserTeamIds(user.id, user.type);
    if (userTeamIds.length === 0) return { allowed: false };

    // Per-type create capability, then any sibling type whose creator grant
    // also authorizes (mirrors the backend `create.alsoAcceptCreatorOf`).
    const creatorTypes = [
      input.objectType,
      ...(input.alsoAcceptCreatorOf ?? []),
    ];
    for (const objectType of creatorTypes) {
      if (await teamsHoldCreatorGrant(objectType, userTeamIds)) {
        return { allowed: true };
      }
    }

    // Parent gate: managing any object of the parent type authorizes creating
    // the child for it (e.g. manage a system -> open an incident/maintenance).
    if (input.parentType) {
      const hasParentManage = await tupleStore.hasAnyTypeGrant({
        objectType: input.parentType,
        userTeamIds,
        action: "manage",
      });
      if (hasParentManage) return { allowed: true };
    }

    return { allowed: false };
  });

  // The resource types the caller can create or manage any object of via a team
  // grant. Powers capability-aware nav/route gating (the frontend ORs the global
  // rule). Empty for anonymous callers and users with no teams.
  const myManageableTypes = os.myManageableTypes.handler(
    async ({ context }) => {
      const user = context.user;
      if (!user || (user.type !== "user" && user.type !== "application")) {
        return { types: [] };
      }
      const userTeamIds = await resolveUserTeamIds(user.id, user.type);
      if (userTeamIds.length === 0) return { types: [] };
      const types = await tupleStore.manageableTypesForTeams({ userTeamIds });
      return { types };
    },
  );

  // Frontend-facing mirror of the S2S `listAccessibleObjectIds`, resolved with
  // `hasGlobalAccess: false`: returns ONLY the team-derived subset of the given
  // ids the caller may act on. The frontend ORs the global-RBAC path on top, so
  // this deliberately does not resolve global manage here. Anonymous callers and
  // users with no teams get an empty set.
  const listMyAccessibleResources = os.listMyAccessibleResources.handler(
    async ({ context, input }) => {
      const user = context.user;
      if (!user || (user.type !== "user" && user.type !== "application")) {
        return { accessibleIds: [] };
      }
      const candidateIds = [...new Set(input.resourceIds)];
      if (candidateIds.length === 0) return { accessibleIds: [] };

      const userTeamIds = await resolveUserTeamIds(user.id, user.type);
      if (userTeamIds.length === 0) return { accessibleIds: [] };

      const accessibleIds = await tupleStore.listAccessibleObjectIds({
        objectType: input.objectType,
        candidateIds,
        userTeamIds,
        action: input.action,
        hasGlobalAccess: false,
      });
      return { accessibleIds };
    },
  );

  const authorizeCreate = os.authorizeCreate.handler(async ({ input }) => {
    const {
      userId,
      userType,
      objectType,
      requestedTeamId,
      hasGlobalManage,
      alreadyAuthorized,
    } = input;

    const memberTeamIds = new Set(
      await resolveUserTeamIds(userId, userType),
    );

    // Global manage: create globally (no owner) or on behalf of any team.
    // Admin-created objects stay globally readable (not private).
    if (hasGlobalManage) {
      if (requestedTeamId) {
        const exists = await internalDb
          .select({ id: schema.team.id })
          .from(schema.team)
          .where(eq(schema.team.id, requestedTeamId))
          .limit(1);
        if (exists.length === 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Unknown team: ${requestedTeamId}`,
          });
        }
        return { ownerTeamId: requestedTeamId, isPrivate: false };
      }
      return { ownerTeamId: null, isPrivate: false };
    }

    // Authorized by a parent gate (e.g. manage on the system an incident is
    // for): no per-type creator grant needed; resolve the owning team, which
    // must be one the caller belongs to.
    if (alreadyAuthorized) {
      if (requestedTeamId) {
        if (!memberTeamIds.has(requestedTeamId)) {
          throw new ORPCError("FORBIDDEN", {
            message: "You are not a member of the requested team.",
            data: { code: "RESOURCE_TEAM_FORBIDDEN", resourceType: objectType },
          });
        }
        return { ownerTeamId: requestedTeamId, isPrivate: false };
      }
      // No team requested. A parent-gated creator has NO global manage (that
      // branch returned above), so an object with no owning team would be
      // UNEDITABLE by them afterwards (no team grant, no global rule). If the
      // caller belongs to teams, require an explicit owning team (auto-assign
      // when there is exactly one) so they retain manage on what they create.
      // Only a caller who belongs to NO team - i.e. reached the gate via a
      // GLOBAL parent rule, not team membership - may create a team-less,
      // globally-readable object.
      const ownableTeamIds = [...memberTeamIds];
      if (ownableTeamIds.length === 1) {
        return { ownerTeamId: ownableTeamIds[0], isPrivate: false };
      }
      if (ownableTeamIds.length > 1) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Choose which team should own the new resource.",
          data: {
            code: "OWNER_TEAM_REQUIRED",
            resourceType: objectType,
            eligibleTeamIds: ownableTeamIds,
          },
        });
      }
      return { ownerTeamId: null, isPrivate: false };
    }

    // No global manage: only the caller's teams holding a `creator` grant for
    // this type may own a new object.
    const eligibleTeamIds = await tupleStore.creatorTeamIds({
      objectType,
      userTeamIds: [...memberTeamIds],
    });

    if (requestedTeamId) {
      if (!memberTeamIds.has(requestedTeamId)) {
        throw new ORPCError("FORBIDDEN", {
          message: "You are not a member of the requested team.",
          data: { code: "RESOURCE_TEAM_FORBIDDEN", resourceType: objectType },
        });
      }
      if (!eligibleTeamIds.includes(requestedTeamId)) {
        throw new ORPCError("FORBIDDEN", {
          message: "Your team is not permitted to create this resource type.",
          data: { code: "RESOURCE_CREATE_FORBIDDEN", resourceType: objectType },
        });
      }
      // Member-created object is MANAGED by the owning team but stays globally
      // readable by default (privacy is an explicit opt-in via setObjectPublic).
      return { ownerTeamId: requestedTeamId, isPrivate: false };
    }

    if (eligibleTeamIds.length === 0) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to create this resource.",
        data: { code: "RESOURCE_CREATE_FORBIDDEN", resourceType: objectType },
      });
    }
    if (eligibleTeamIds.length > 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose which team should own the new resource.",
        data: {
          code: "OWNER_TEAM_REQUIRED",
          resourceType: objectType,
          eligibleTeamIds,
        },
      });
    }
    return { ownerTeamId: eligibleTeamIds[0], isPrivate: false };
  });

  const setOwner = os.setOwner.handler(async ({ input }) => {
    // The store writes the `public` marker unless the object is private; a
    // freshly-created object is globally readable by default (isPrivate=false).
    await tupleStore.setOwner({
      objectType: input.objectType,
      objectId: input.objectId,
      teamId: input.teamId,
      isPublic: !(input.isPrivate ?? false),
    });
  });

  const getOwnStrategyConfig = os.getOwnStrategyConfig.handler(
    async ({ context }) => {
      if (context.user?.type !== "service") {
        throw new ORPCError("UNAUTHORIZED", {
          message: "This endpoint is only callable by services.",
        });
      }

      const callerPluginId = context.user?.pluginId;

      // Infer strategyId from pluginId (e.g. auth-ldap-backend -> ldap)
      const strategyId = callerPluginId
        .replace(/^auth-/, "")
        .replace(/-backend$/, "");

      const strategy = strategyRegistry
        .getStrategies()
        .find((s) => s.id === strategyId);

      if (!strategy) {
        throw new ORPCError("NOT_FOUND", {
          message: `No strategy found for plugin ${callerPluginId} (inferred strategy ID: ${strategyId})`,
        });
      }

      // Load full (non-redacted) config from ConfigService
      // These configurations are stored in the auth-backend's scope
      const config = await configService.get(
        strategy.id,
        strategy.configSchema,
        strategy.configVersion,
        strategy.migrations,
      );

      if (!config) {
        throw new ORPCError("NOT_FOUND", {
          message: `Configuration not found for strategy ${strategyId}`,
        });
      }

      return { config: config as Record<string, unknown> };
    },
  );

  return os.router({
    getEnabledStrategies,
    accessRules: accessRulesHandler,
    getUsers,
    searchUsers,
    deleteUser,
    getRoles,
    getAccessRules,
    createRole,
    updateRole,
    deleteRole,
    updateUserRoles,
    getStrategies,
    updateStrategy,
    reloadAuth,
    getRegistrationSchema,
    getRegistrationStatus,
    setRegistrationStatus,
    getMcpOAuthSettings,
    setMcpOAuthSettings,
    getOnboardingStatus,
    completeOnboarding,
    validateResetToken,
    getCurrentUserProfile,
    updateCurrentUser,
    getAnonymousAccessRules,
    getUserById,
    filterUsersByAccessRule,
    findUserByEmail,
    upsertExternalUser,
    createSession,
    createCredentialUser,
    getApplications,
    createApplication,
    updateApplication,
    deleteApplication,
    regenerateApplicationSecret,
    enrichApplicationPrincipal,
    getBindableApplications,
    getOwnStrategyConfig,
    // Teams
    getTeams,
    getTeam,
    createTeam,
    updateTeam,
    deleteTeam,
    addUserToTeam,
    removeUserFromTeam,
    addTeamManager,
    removeTeamManager,
    listObjectRelations,
    listObjectRelationsBulk,
    writeRelation,
    removeRelation,
    setObjectPublic,
    check,
    listAccessibleObjectIds,
    deleteObjectRelations,
    hasAnyTypeGrant,
    getResourceKinds,
    resolveResourceNames,
    searchResources,
    listSubjectRelations,
    getMyTeams,
    getMyManagingTeams,
    setCreateGrant,
    listTeamCreateGrants,
    canCreate,
    myManageableTypes,
    listMyAccessibleResources,
    hasCreateCapability,
    authorizeCreate,
    setOwner,
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
