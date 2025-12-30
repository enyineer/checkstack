import { implement, ORPCError } from "@orpc/server";
import type { RpcContext } from "@checkmate/backend-api";
import {
  type AuthStrategy,
  type ConfigService,
  toJsonSchema,
} from "@checkmate/backend-api";
import { authContract } from "@checkmate/auth-common";
import * as schema from "./schema";
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  strategyMetaConfigV1,
  STRATEGY_META_CONFIG_VERSION,
} from "./meta-config";
import {
  platformRegistrationConfigV1,
  PLATFORM_REGISTRATION_CONFIG_VERSION,
  PLATFORM_REGISTRATION_CONFIG_ID,
} from "./platform-registration-config";

// Create implementer from contract with our context
const os = implement(authContract).$context<RpcContext>();

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

export const createAuthRouter = (
  internalDb: NodePgDatabase<typeof schema>,
  strategyRegistry: { getStrategies: () => AuthStrategy<unknown>[] },
  reloadAuthFn: () => Promise<void>,
  configService: ConfigService,
  permissionRegistry: {
    getPermissions: () => { id: string; description?: string }[];
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
    return { permissions: context.user?.permissions || [] };
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

  const deleteUser = os.deleteUser.handler(async ({ input: id }) => {
    if (id === "initial-admin-id") {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot delete initial admin",
      });
    }
    await internalDb.delete(schema.user).where(eq(schema.user.id, id));
  });

  const getRoles = os.getRoles.handler(async () => {
    const roles = await internalDb.select().from(schema.role);
    const rolePermissions = await internalDb
      .select()
      .from(schema.rolePermission);

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      permissions: rolePermissions
        .filter((rp) => rp.roleId === role.id)
        .map((rp) => rp.permissionId),
      isSystem: role.isSystem || false,
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

    // Security check: prevent users from modifying their own roles
    const userRoles = context.user?.roles || [];
    if (userRoles.includes(id)) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot modify a role that you currently have",
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
        message: "Cannot modify system role",
      });
    }

    // Get active permissions to filter input
    const activePermissions = new Set(
      permissionRegistry.getPermissions().map((p) => p.id)
    );

    // Filter to only include active permissions
    const validPermissions = inputPermissions.filter((p) =>
      activePermissions.has(p)
    );

    await internalDb.transaction(async (tx) => {
      // Update role name/description if provided
      if (name !== undefined || description !== undefined) {
        const updates: { name?: string; description?: string | null } = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;

        await tx.update(schema.role).set(updates).where(eq(schema.role.id, id));
      }

      // Replace permission mappings
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
    const userRoles = context.user?.roles || [];
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

    // Delete role (cascades to user_role and role_permission via foreign keys)
    await internalDb.delete(schema.role).where(eq(schema.role.id, id));
  });

  const updateUserRoles = os.updateUserRoles.handler(
    async ({ input, context }) => {
      const { userId, roles } = input;

      if (userId === context.user?.id) {
        throw new ORPCError("FORBIDDEN", {
          message: "Cannot update your own roles",
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
          enabled,
          configVersion: strategy.configVersion,
          configSchema: jsonSchema,
          config,
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
    getRegistrationStatus,
    setRegistrationStatus,
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
