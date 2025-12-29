import { implement } from "@orpc/server";
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

// Create implementer from contract with our context
const os = implement(authContract).$context<RpcContext>();

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
      throw new Error("Cannot delete initial admin");
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
    const { id, name, description, permissions: inputPermissions } = input;

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
      throw new Error("Cannot modify a role that you currently have");
    }

    // Check if role is a system role
    const existingRole = await internalDb
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, id));

    if (existingRole.length === 0) {
      throw new Error(`Role ${id} not found`);
    }

    if (existingRole[0].isSystem) {
      throw new Error("Cannot modify system role");
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
      throw new Error("Cannot delete a role that you currently have");
    }

    // Check if role is a system role
    const existingRole = await internalDb
      .select()
      .from(schema.role)
      .where(eq(schema.role.id, id));

    if (existingRole.length === 0) {
      throw new Error(`Role ${id} not found`);
    }

    if (existingRole[0].isSystem) {
      throw new Error("Cannot delete system role");
    }

    // Delete role (cascades to user_role and role_permission via foreign keys)
    await internalDb.delete(schema.role).where(eq(schema.role.id, id));
  });

  const updateUserRoles = os.updateUserRoles.handler(
    async ({ input, context }) => {
      const { userId, roles } = input;

      if (userId === context.user?.id) {
        throw new Error("Cannot update your own roles");
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

        // Check if strategy is enabled
        const enabled =
          config && typeof config === "object" && "enabled" in config
            ? config.enabled !== false
            : true;

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
      throw new Error(`Strategy ${id} not found`);
    }

    // Prepare config for storage if provided
    if (config) {
      // Add enabled flag to config
      const configWithEnabled = { ...config, enabled };

      // Store using ConfigService (handles encryption and versioning)
      await configService.set(
        id,
        strategy.configSchema,
        strategy.configVersion,
        configWithEnabled,
        strategy.migrations
      );
    } else {
      // Just update enabled status
      const existingConfig = await configService.get(
        id,
        strategy.configSchema,
        strategy.configVersion,
        strategy.migrations
      );

      if (existingConfig) {
        // Update config with new enabled status
        const configWithEnabled =
          typeof existingConfig === "object" && existingConfig !== null
            ? { ...existingConfig, enabled }
            : { enabled };

        await configService.set(
          id,
          strategy.configSchema,
          strategy.configVersion,
          configWithEnabled,
          strategy.migrations
        );
      } else {
        // No existing config, create minimal one with enabled flag
        await configService.set(
          id,
          strategy.configSchema,
          strategy.configVersion,
          { enabled } as never,
          strategy.migrations
        );
      }
    }

    // Trigger auth reload
    await reloadAuthFn();

    return { success: true };
  });

  const reloadAuth = os.reloadAuth.handler(async () => {
    await reloadAuthFn();
    return { success: true };
  });

  return os.router({
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
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
