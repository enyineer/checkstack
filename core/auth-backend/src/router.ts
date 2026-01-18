import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
  type AuthUser,
  type RealUser,
  type AuthStrategy,
  type ConfigService,
  toJsonSchema,
} from "@checkstack/backend-api";
import { authContract, passwordSchema } from "@checkstack/auth-common";
import { hashPassword } from "better-auth/crypto";
import * as schema from "./schema";
import { eq, inArray, and } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { authHooks } from "./hooks";

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

export const ADMIN_ROLE_ID = "admin";
export const USERS_ROLE_ID = "users";
export const ANONYMOUS_ROLE_ID = "anonymous";
export const APPLICATIONS_ROLE_ID = "applications";

/**
 * Creates the auth router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(authContract)
  .$context<RpcContext>()
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
    }[];
  },
) => {
  // Public endpoint for enabled strategies (no authentication required)
  const getEnabledStrategies = os.getEnabledStrategies.handler(async () => {
    const registeredStrategies = strategyRegistry.getStrategies();

    const enabledStrategies = await Promise.all(
      registeredStrategies.map(async (strategy) => {
        // Get enabled state from meta config
        const enabled = await getStrategyEnabled(strategy.id, configService);

        // Determine strategy type
        const type: "credential" | "social" =
          strategy.id === "credential" ? "credential" : "social";

        return {
          id: strategy.id,
          displayName: strategy.displayName,
          description: strategy.description,
          type,
          enabled,
          icon: strategy.icon,
          requiresManualRegistration: strategy.requiresManualRegistration,
        };
      }),
    );

    // Filter to only return enabled strategies
    return enabledStrategies.filter((s) => s.enabled);
  });

  const accessRulesHandler = os.accessRules.handler(async ({ context }) => {
    const user = context.user;
    if (!isRealUser(user)) {
      return { accessRules: [] };
    }
    return { accessRules: user.accessRules || [] };
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
      // Delete user roles
      await tx.delete(schema.userRole).where(eq(schema.userRole.userId, id));

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

    await internalDb.transaction(async (tx) => {
      // Create role
      await tx.insert(schema.role).values({
        id,
        name,
        description: description || undefined,
        isSystem: false,
      });

      // Create role-access rule mappings
      if (validAccessRules.length > 0) {
        await tx.insert(schema.roleAccessRule).values(
          validAccessRules.map((accessRuleId) => ({
            roleId: id,
            accessRuleId,
          })),
        );
      }
    });
  });

  const updateRole = os.updateRole.handler(async ({ input, context }) => {
    const { id, name, description, accessRules: inputAccessRules } = input;

    // Track if user has this role (for access elevation prevention)
    const userRoles = isRealUser(context.user) ? context.user.roles || [] : [];
    const isUserOwnRole = userRoles.includes(id);

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

    await internalDb.transaction(async (tx) => {
      // Update role name/description if provided (allowed for ALL roles including system and own roles)
      if (name !== undefined || description !== undefined) {
        const updates: { name?: string; description?: string | null } = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;

        await tx.update(schema.role).set(updates).where(eq(schema.role.id, id));
      }

      // Skip access rule changes for admin role (wildcard) or user's own role (prevent access elevation)
      if (isAdminRole || isUserOwnRole) {
        return; // Don't modify access rules
      }

      // Replace access rule mappings for non-admin roles
      await tx
        .delete(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.roleId, id));

      if (validAccessRules.length > 0) {
        await tx.insert(schema.roleAccessRule).values(
          validAccessRules.map((accessRuleId) => ({
            roleId: id,
            accessRuleId,
          })),
        );
      }
    });
  });

  const deleteRole = os.deleteRole.handler(async ({ input: id, context }) => {
    // Security check: prevent users from deleting their own roles
    const userRoles = isRealUser(context.user) ? context.user.roles || [] : [];
    if (userRoles.includes(id)) {
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

    // Delete role and related records in transaction
    await internalDb.transaction(async (tx) => {
      // Delete role-access-rule mappings
      await tx
        .delete(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.roleId, id));

      // Delete user-role mappings
      await tx.delete(schema.userRole).where(eq(schema.userRole.roleId, id));

      // Delete the role itself
      await tx.delete(schema.role).where(eq(schema.role.id, id));
    });
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

      await internalDb.transaction(async (tx) => {
        await tx
          .delete(schema.userRole)
          .where(eq(schema.userRole.userId, userId));
        if (roles.length > 0) {
          await tx.insert(schema.userRole).values(
            roles.map((roleId) => ({
              userId,
              roleId,
            })),
          );
        }
      });
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

  // ==========================================================================
  // ONBOARDING ENDPOINTS
  // ==========================================================================

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

      // Security check: only allow if no users exist
      const existingUsers = await internalDb
        .select({ id: schema.user.id })
        .from(schema.user)
        .limit(1);

      if (existingUsers.length > 0) {
        throw new ORPCError("FORBIDDEN", {
          message: "Onboarding has already been completed.",
        });
      }

      // Validate password against platform's password schema
      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: passwordValidation.error.issues
            .map((issue) => issue.message)
            .join(", "),
        });
      }

      // Create the first admin user
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

        // Assign admin role
        await tx.insert(schema.userRole).values({
          userId,
          roleId: ADMIN_ROLE_ID,
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
    async () => {
      const rolePerms = await internalDb
        .select()
        .from(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.roleId, ANONYMOUS_ROLE_ID));
      return rolePerms.map((rp) => rp.accessRuleId);
    },
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
        if (rolesToAdd.length > 0) {
          await internalDb
            .insert(schema.userRole)
            .values(rolesToAdd.map((roleId) => ({ userId, roleId })));
          context.logger.info(
            `Added ${rolesToAdd.length} roles for external user: ${email}`,
          );
        }

        // Remove roles that are managed but user no longer has in directory
        if (managedRoleIds && managedRoleIds.length > 0) {
          // Roles to remove: currently has + is managed + NOT in sync roles
          const rolesToRemove = [...currentRoleIds].filter(
            (id) => managedRoleIds.includes(id) && !syncRoleSet.has(id),
          );
          if (rolesToRemove.length > 0) {
            await internalDb
              .delete(schema.userRole)
              .where(
                and(
                  eq(schema.userRole.userId, userId),
                  inArray(schema.userRole.roleId, rolesToRemove),
                ),
              );
            context.logger.info(
              `Removed ${rolesToRemove.length} managed roles for external user: ${email}`,
            );
          }
        }
      }

      return { userId, created };
    },
  );

  const createSession = os.createSession.handler(async ({ input }) => {
    const { userId, token, expiresAt } = input;
    const sessionId = crypto.randomUUID();
    const now = new Date();

    await internalDb.insert(schema.session).values({
      id: sessionId,
      userId,
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return { sessionId };
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

        // Assign "users" role to new user
        await tx.insert(schema.userRole).values({
          userId,
          roleId: USERS_ROLE_ID,
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

  // ==========================================================================
  // TEAM MANAGEMENT HANDLERS
  // ==========================================================================

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

    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberCount: memberCounts.filter((m) => m.teamId === t.id).length,
      isManager: managedTeamIds.has(t.id),
    }));
  });

  const getTeam = os.getTeam.handler(async ({ input }) => {
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
    // TODO: Check if user is manager or has teamsManage access
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
    await internalDb.transaction(async (tx) => {
      await tx.delete(schema.userTeam).where(eq(schema.userTeam.teamId, id));
      await tx
        .delete(schema.teamManager)
        .where(eq(schema.teamManager.teamId, id));
      await tx
        .delete(schema.applicationTeam)
        .where(eq(schema.applicationTeam.teamId, id));
      await tx
        .delete(schema.resourceTeamAccess)
        .where(eq(schema.resourceTeamAccess.teamId, id));
      await tx.delete(schema.team).where(eq(schema.team.id, id));
    });
    context.logger.info(`[auth-backend] Deleted team: ${id}`);
  });

  const addUserToTeam = os.addUserToTeam.handler(async ({ input }) => {
    await internalDb
      .insert(schema.userTeam)
      .values({ userId: input.userId, teamId: input.teamId })
      .onConflictDoNothing();
  });

  const removeUserFromTeam = os.removeUserFromTeam.handler(
    async ({ input }) => {
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

  const addTeamManager = os.addTeamManager.handler(async ({ input }) => {
    await internalDb
      .insert(schema.teamManager)
      .values({ userId: input.userId, teamId: input.teamId })
      .onConflictDoNothing();
  });

  const removeTeamManager = os.removeTeamManager.handler(async ({ input }) => {
    await internalDb
      .delete(schema.teamManager)
      .where(
        and(
          eq(schema.teamManager.userId, input.userId),
          eq(schema.teamManager.teamId, input.teamId),
        ),
      );
  });

  const getResourceTeamAccess = os.getResourceTeamAccess.handler(
    async ({ input }) => {
      const rows = await internalDb
        .select()
        .from(schema.resourceTeamAccess)
        .innerJoin(
          schema.team,
          eq(schema.resourceTeamAccess.teamId, schema.team.id),
        )
        .where(
          and(
            eq(schema.resourceTeamAccess.resourceType, input.resourceType),
            eq(schema.resourceTeamAccess.resourceId, input.resourceId),
          ),
        );
      return rows.map((r) => ({
        teamId: r.resource_team_access.teamId,
        teamName: r.team.name,
        canRead: r.resource_team_access.canRead,
        canManage: r.resource_team_access.canManage,
      }));
    },
  );

  const setResourceTeamAccess = os.setResourceTeamAccess.handler(
    async ({ input }) => {
      const { resourceType, resourceId, teamId, canRead, canManage } = input;
      await internalDb
        .insert(schema.resourceTeamAccess)
        .values({
          resourceType,
          resourceId,
          teamId,
          canRead: canRead ?? true,
          canManage: canManage ?? false,
        })
        .onConflictDoUpdate({
          target: [
            schema.resourceTeamAccess.resourceType,
            schema.resourceTeamAccess.resourceId,
            schema.resourceTeamAccess.teamId,
          ],
          set: {
            canRead: canRead ?? true,
            canManage: canManage ?? false,
          },
        });
    },
  );

  const removeResourceTeamAccess = os.removeResourceTeamAccess.handler(
    async ({ input }) => {
      await internalDb
        .delete(schema.resourceTeamAccess)
        .where(
          and(
            eq(schema.resourceTeamAccess.resourceType, input.resourceType),
            eq(schema.resourceTeamAccess.resourceId, input.resourceId),
            eq(schema.resourceTeamAccess.teamId, input.teamId),
          ),
        );
    },
  );

  // Resource-level access settings
  const getResourceAccessSettings = os.getResourceAccessSettings.handler(
    async ({ input }) => {
      const rows = await internalDb
        .select()
        .from(schema.resourceAccessSettings)
        .where(
          and(
            eq(schema.resourceAccessSettings.resourceType, input.resourceType),
            eq(schema.resourceAccessSettings.resourceId, input.resourceId),
          ),
        )
        .limit(1);
      return { teamOnly: rows[0]?.teamOnly ?? false };
    },
  );

  const setResourceAccessSettings = os.setResourceAccessSettings.handler(
    async ({ input }) => {
      const { resourceType, resourceId, teamOnly } = input;
      await internalDb
        .insert(schema.resourceAccessSettings)
        .values({ resourceType, resourceId, teamOnly })
        .onConflictDoUpdate({
          target: [
            schema.resourceAccessSettings.resourceType,
            schema.resourceAccessSettings.resourceId,
          ],
          set: { teamOnly },
        });
    },
  );

  // S2S Endpoints for middleware
  const checkResourceTeamAccess = os.checkResourceTeamAccess.handler(
    async ({ input }) => {
      const {
        userId,
        userType,
        resourceType,
        resourceId,
        action,
        hasGlobalAccess,
      } = input;

      const grants = await internalDb
        .select()
        .from(schema.resourceTeamAccess)
        .where(
          and(
            eq(schema.resourceTeamAccess.resourceType, resourceType),
            eq(schema.resourceTeamAccess.resourceId, resourceId),
          ),
        );

      // No grants = global access applies
      if (grants.length === 0) return { hasAccess: hasGlobalAccess };

      // Check resource-level settings for teamOnly
      const settingsRows = await internalDb
        .select()
        .from(schema.resourceAccessSettings)
        .where(
          and(
            eq(schema.resourceAccessSettings.resourceType, resourceType),
            eq(schema.resourceAccessSettings.resourceId, resourceId),
          ),
        )
        .limit(1);
      const isTeamOnly = settingsRows[0]?.teamOnly ?? false;

      if (!isTeamOnly && hasGlobalAccess) return { hasAccess: true };

      // Get user's teams
      const teamTable =
        userType === "user" ? schema.userTeam : schema.applicationTeam;
      const userIdCol =
        userType === "user"
          ? schema.userTeam.userId
          : schema.applicationTeam.applicationId;
      const userTeams = await internalDb
        .select({
          teamId:
            userType === "user"
              ? schema.userTeam.teamId
              : schema.applicationTeam.teamId,
        })
        .from(teamTable)
        .where(eq(userIdCol, userId));
      const userTeamIds = new Set(userTeams.map((t) => t.teamId));

      const field = action === "manage" ? "canManage" : "canRead";
      const hasAccess = grants.some(
        (g) => userTeamIds.has(g.teamId) && g[field],
      );
      return { hasAccess };
    },
  );

  const getAccessibleResourceIds = os.getAccessibleResourceIds.handler(
    async ({ input }) => {
      const {
        userId,
        userType,
        resourceType,
        resourceIds,
        action,
        hasGlobalAccess,
      } = input;
      if (resourceIds.length === 0) return [];

      // Get all grants for these resources
      const grants = await internalDb
        .select()
        .from(schema.resourceTeamAccess)
        .where(
          and(
            eq(schema.resourceTeamAccess.resourceType, resourceType),
            inArray(schema.resourceTeamAccess.resourceId, resourceIds),
          ),
        );

      // Get resource-level settings for teamOnly
      const settingsRows = await internalDb
        .select()
        .from(schema.resourceAccessSettings)
        .where(
          and(
            eq(schema.resourceAccessSettings.resourceType, resourceType),
            inArray(schema.resourceAccessSettings.resourceId, resourceIds),
          ),
        );
      const teamOnlyByResource = new Map(
        settingsRows.map((s) => [s.resourceId, s.teamOnly]),
      );

      // Get user's teams
      const teamTable =
        userType === "user" ? schema.userTeam : schema.applicationTeam;
      const userIdCol =
        userType === "user"
          ? schema.userTeam.userId
          : schema.applicationTeam.applicationId;
      const userTeams = await internalDb
        .select({
          teamId:
            userType === "user"
              ? schema.userTeam.teamId
              : schema.applicationTeam.teamId,
        })
        .from(teamTable)
        .where(eq(userIdCol, userId));
      const userTeamIds = new Set(userTeams.map((t) => t.teamId));

      const field = action === "manage" ? "canManage" : "canRead";
      const grantsByResource = new Map<string, typeof grants>();
      for (const g of grants) {
        const existing = grantsByResource.get(g.resourceId) || [];
        existing.push(g);
        grantsByResource.set(g.resourceId, existing);
      }

      return resourceIds.filter((id) => {
        const resourceGrants = grantsByResource.get(id) || [];
        if (resourceGrants.length === 0) return hasGlobalAccess;
        const isTeamOnly = teamOnlyByResource.get(id) ?? false;
        if (!isTeamOnly && hasGlobalAccess) return true;
        return resourceGrants.some(
          (g) => userTeamIds.has(g.teamId) && g[field],
        );
      });
    },
  );

  const deleteResourceGrants = os.deleteResourceGrants.handler(
    async ({ input }) => {
      await internalDb
        .delete(schema.resourceTeamAccess)
        .where(
          and(
            eq(schema.resourceTeamAccess.resourceType, input.resourceType),
            eq(schema.resourceTeamAccess.resourceId, input.resourceId),
          ),
        );
    },
  );

  return os.router({
    getEnabledStrategies,
    accessRules: accessRulesHandler,
    getUsers,
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
    getOnboardingStatus,
    completeOnboarding,
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
    getResourceTeamAccess,
    setResourceTeamAccess,
    removeResourceTeamAccess,
    getResourceAccessSettings,
    setResourceAccessSettings,
    checkResourceTeamAccess,
    getAccessibleResourceIds,
    deleteResourceGrants,
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
