import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
  type AuthUser,
  type RealUser,
  type AuthStrategy,
  type ConfigService,
  toJsonSchema,
} from "@checkmate-monitor/backend-api";
import { authContract, passwordSchema } from "@checkmate-monitor/auth-common";
import { hashPassword } from "better-auth/crypto";
import * as schema from "./schema";
import { eq, inArray, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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

/**
 * Creates the auth router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
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
  configService: ConfigService
): Promise<boolean> {
  const metaConfig = await configService.get(
    `${strategyId}.meta`,
    strategyMetaConfigV1,
    STRATEGY_META_CONFIG_VERSION
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
  configService: ConfigService
): Promise<void> {
  await configService.set(
    `${strategyId}.meta`,
    strategyMetaConfigV1,
    STRATEGY_META_CONFIG_VERSION,
    { enabled }
  );
}

/**
 * Check if platform-wide registration is currently allowed.
 *
 * @param configService - The ConfigService instance
 * @returns true if registration is allowed, false otherwise
 */
async function isRegistrationAllowed(
  configService: ConfigService
): Promise<boolean> {
  const config = await configService.get(
    PLATFORM_REGISTRATION_CONFIG_ID,
    platformRegistrationConfigV1,
    PLATFORM_REGISTRATION_CONFIG_VERSION
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
  internalDb: NodePgDatabase<typeof schema>,
  strategyRegistry: { getStrategies: () => AuthStrategy<unknown>[] },
  reloadAuthFn: () => Promise<void>,
  configService: ConfigService,
  permissionRegistry: {
    getPermissions: () => {
      id: string;
      description?: string;
      isAuthenticatedDefault?: boolean;
      isPublicDefault?: boolean;
    }[];
  }
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
      })
    );

    // Filter to only return enabled strategies
    return enabledStrategies.filter((s) => s.enabled);
  });

  const permissions = os.permissions.handler(async ({ context }) => {
    const user = context.user;
    if (!isRealUser(user)) {
      return { permissions: [] };
    }
    return { permissions: user.permissions || [] };
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
          users.map((u) => u.id)
        )
      );

    return users.map((u) => ({
      ...u,
      roles: userRoles
        .filter((ur) => ur.userId === u.id)
        .map((ur) => ur.roleId),
    }));
  });

  const deleteUser = os.deleteUser.handler(async ({ input: id, context }) => {
    if (id === "initial-admin-id") {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot delete initial admin",
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
    const rolePermissions = await internalDb
      .select()
      .from(schema.rolePermission);

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: rolePermissions
        .filter((rp) => rp.roleId === role.id)
        .map((rp) => rp.permissionId),
      isSystem: role.isSystem || false,
      // Anonymous role cannot be assigned to users - it's for unauthenticated access
      isAssignable: role.id !== "anonymous",
    }));
  });

  const getPermissions = os.getPermissions.handler(async () => {
    // Return only currently active permissions (registered by loaded plugins)
    return permissionRegistry.getPermissions();
  });

  const createRole = os.createRole.handler(async ({ input }) => {
    const { name, description, permissions: inputPermissions } = input;

    // Generate UUID for new role
    const id = crypto.randomUUID();

    // Get active permissions to filter input
    const activePermissions = new Set(
      permissionRegistry.getPermissions().map((p) => p.id)
    );

    // Filter to only include active permissions
    const validPermissions = inputPermissions.filter((p) =>
      activePermissions.has(p)
    );

    await internalDb.transaction(async (tx) => {
      // Create role
      await tx.insert(schema.role).values({
        id,
        name,
        description: description || undefined,
        isSystem: false,
      });

      // Create role-permission mappings
      if (validPermissions.length > 0) {
        await tx.insert(schema.rolePermission).values(
          validPermissions.map((permissionId) => ({
            roleId: id,
            permissionId,
          }))
        );
      }
    });
  });

  const updateRole = os.updateRole.handler(async ({ input, context }) => {
    const { id, name, description, permissions: inputPermissions } = input;

    // Track if user has this role (for permission elevation prevention)
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

    const isUsersRole = id === "users";
    const isAdminRole = id === "admin";

    // System roles can have name/description edited, but not deleted
    // Admin role: permissions cannot be changed (wildcard permission)
    // Users role: permissions can be changed with default tracking
    // User's own role: permissions cannot be changed (prevent self-elevation)

    // Get active permissions to filter input
    const activePermissions = new Set(
      permissionRegistry.getPermissions().map((p) => p.id)
    );

    // Filter to only include active permissions
    const validPermissions = inputPermissions.filter((p) =>
      activePermissions.has(p)
    );

    // Track disabled authenticated default permissions for "users" role
    if (isUsersRole && !isUserOwnRole) {
      const allPerms = permissionRegistry.getPermissions();
      const defaultPermIds = allPerms
        .filter((p) => p.isAuthenticatedDefault)
        .map((p) => p.id);

      // Find authenticated default permissions that are being removed
      const removedDefaults = defaultPermIds.filter(
        (defId) => !validPermissions.includes(defId)
      );

      // Insert into disabled_default_permission table
      for (const permId of removedDefaults) {
        await internalDb
          .insert(schema.disabledDefaultPermission)
          .values({
            permissionId: permId,
            disabledAt: new Date(),
          })
          .onConflictDoNothing();
      }

      // Remove from disabled table if being re-added
      const readdedDefaults = validPermissions.filter((p) =>
        defaultPermIds.includes(p)
      );
      for (const permId of readdedDefaults) {
        await internalDb
          .delete(schema.disabledDefaultPermission)
          .where(eq(schema.disabledDefaultPermission.permissionId, permId));
      }
    }

    // Track disabled public default permissions for "anonymous" role
    const isAnonymousRole = id === "anonymous";
    if (isAnonymousRole) {
      const allPerms = permissionRegistry.getPermissions();
      const publicDefaultPermIds = allPerms
        .filter((p) => p.isPublicDefault)
        .map((p) => p.id);

      // Find public default permissions that are being removed
      const removedPublicDefaults = publicDefaultPermIds.filter(
        (defId) => !validPermissions.includes(defId)
      );

      // Insert into disabled_public_default_permission table
      for (const permId of removedPublicDefaults) {
        await internalDb
          .insert(schema.disabledPublicDefaultPermission)
          .values({
            permissionId: permId,
            disabledAt: new Date(),
          })
          .onConflictDoNothing();
      }

      // Remove from disabled table if being re-added
      const readdedPublicDefaults = validPermissions.filter((p) =>
        publicDefaultPermIds.includes(p)
      );
      for (const permId of readdedPublicDefaults) {
        await internalDb
          .delete(schema.disabledPublicDefaultPermission)
          .where(
            eq(schema.disabledPublicDefaultPermission.permissionId, permId)
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

      // Skip permission changes for admin role (wildcard) or user's own role (prevent self-elevation)
      if (isAdminRole || isUserOwnRole) {
        return; // Don't modify permissions
      }

      // Replace permission mappings for non-admin roles
      await tx
        .delete(schema.rolePermission)
        .where(eq(schema.rolePermission.roleId, id));

      if (validPermissions.length > 0) {
        await tx.insert(schema.rolePermission).values(
          validPermissions.map((permissionId) => ({
            roleId: id,
            permissionId,
          }))
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
      // Delete role-permission mappings
      await tx
        .delete(schema.rolePermission)
        .where(eq(schema.rolePermission.roleId, id));

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
      if (roles.includes("anonymous")) {
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
            }))
          );
        }
      });
    }
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
          strategy.migrations
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
      })
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
        strategy.migrations
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
        { allowRegistration: input.allowRegistration }
      );
      // Trigger auth reload to apply new settings
      await reloadAuthFn();
      return { success: true };
    }
  );

  const getAnonymousPermissions = os.getAnonymousPermissions.handler(
    async () => {
      const rolePerms = await internalDb
        .select()
        .from(schema.rolePermission)
        .where(eq(schema.rolePermission.roleId, "anonymous"));
      return rolePerms.map((rp) => rp.permissionId);
    }
  );

  const filterUsersByPermission = os.filterUsersByPermission.handler(
    async ({ input }) => {
      const { userIds, permission } = input;

      if (userIds.length === 0) return [];

      // Single efficient query: join user_role with role_permission
      // and filter by both userIds AND the specific permission
      const usersWithPermission = await internalDb
        .select({ userId: schema.userRole.userId })
        .from(schema.userRole)
        .innerJoin(
          schema.rolePermission,
          eq(schema.userRole.roleId, schema.rolePermission.roleId)
        )
        .where(
          and(
            inArray(schema.userRole.userId, userIds),
            eq(schema.rolePermission.permissionId, permission)
          )
        )
        .groupBy(schema.userRole.userId);

      return usersWithPermission.map((row) => row.userId);
    }
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
      const { email, name, providerId, accountId, password, autoUpdateUser } =
        input;

      // Check if user exists
      const existingUsers = await internalDb
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);

      if (existingUsers.length > 0) {
        // User exists - update if autoUpdateUser is enabled
        const userId = existingUsers[0].id;

        if (autoUpdateUser) {
          await internalDb
            .update(schema.user)
            .set({ name, updatedAt: new Date() })
            .where(eq(schema.user.id, userId));
        }

        return { userId, created: false };
      }

      // Check if registration is allowed before creating new user
      const registrationAllowed = await isRegistrationAllowed(configService);
      if (!registrationAllowed) {
        throw new ORPCError("FORBIDDEN", {
          message: "Registration is disabled. Please contact an administrator.",
        });
      }

      // Create new user and account in a transaction
      const userId = crypto.randomUUID();
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

      return { userId, created: true };
    }
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
        configService
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
          roleId: "users",
        });
      });

      context.logger.info(
        `[auth-backend] Admin created credential user: ${email}`
      );

      return { userId };
    }
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
          apps.map((a) => a.id)
        )
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
      const defaultRole = "applications";

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
        `[auth-backend] Created application: ${name} (${id})`
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
    }
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
            }))
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
    }
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
        `[auth-backend] Regenerated secret for application: ${id}`
      );

      return { secret: `ck_${id}_${secret}` };
    }
  );

  return os.router({
    getEnabledStrategies,
    permissions,
    getUsers,
    deleteUser,
    getRoles,
    getPermissions,
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
    getAnonymousPermissions,
    getUserById,
    filterUsersByPermission,
    findUserByEmail,
    upsertExternalUser,
    createSession,
    createCredentialUser,
    getApplications,
    createApplication,
    updateApplication,
    deleteApplication,
    regenerateApplicationSecret,
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
