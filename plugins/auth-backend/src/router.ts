import {
  os,
  authedProcedure,
  permissionMiddleware,
  zod,
} from "@checkmate/backend-api";
import {
  permissions as authPermissions,
  type AuthRpcContract,
} from "@checkmate/auth-common";
import * as schema from "./schema";
import { eq, inArray } from "drizzle-orm";
import { betterAuth } from "better-auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const usersRead = permissionMiddleware(authPermissions.usersRead.id);
const usersManage = permissionMiddleware(authPermissions.usersManage.id);
const rolesManage = permissionMiddleware(authPermissions.rolesManage.id);
const strategiesManage = permissionMiddleware(
  authPermissions.strategiesManage.id
);

export interface AuthStrategyInfo {
  id: string;
}

export const createAuthRouter = (
  auth: ReturnType<typeof betterAuth>,
  internalDb: NodePgDatabase<typeof schema>,
  availableStrategies: AuthStrategyInfo[]
) => {
  return os.router({
    permissions: authedProcedure.handler(async ({ context }) => {
      return { permissions: context.user?.permissions || [] };
    }),

    getUsers: authedProcedure.use(usersRead).handler(async () => {
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
    }),

    deleteUser: authedProcedure
      .use(usersManage)
      .input(zod.string())
      .handler(async ({ input: id }) => {
        if (id === "initial-admin-id") {
          throw new Error("Cannot delete initial admin");
        }
        await internalDb.delete(schema.user).where(eq(schema.user.id, id));
        return { success: true };
      }),

    getRoles: authedProcedure.use(rolesManage).handler(async () => {
      return internalDb.select().from(schema.role);
    }),

    updateUserRoles: authedProcedure
      .use(rolesManage)
      .input(
        zod.object({
          userId: zod.string(),
          roles: zod.array(zod.string()),
        })
      )
      .handler(async ({ input, context }) => {
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

        return { success: true };
      }),

    getStrategies: authedProcedure.use(strategiesManage).handler(async () => {
      const dbStrategies = await internalDb.select().from(schema.authStrategy);

      const result = availableStrategies.map((s) => {
        const dbS = dbStrategies.find((ds) => ds.id === s.id);
        return {
          id: s.id,
          enabled: dbS ? dbS.enabled : true,
        };
      });

      // Also include credential strategy
      result.push({
        id: "credential",
        enabled:
          dbStrategies.find((ds) => ds.id === "credential")?.enabled ?? true,
      });

      return result;
    }),

    updateStrategy: authedProcedure
      .use(strategiesManage)
      .input(
        zod.object({
          id: zod.string(),
          enabled: zod.boolean(),
        })
      )
      .handler(async ({ input }) => {
        const { id, enabled } = input;

        await internalDb
          .insert(schema.authStrategy)
          .values({ id, enabled })
          .onConflictDoUpdate({
            target: schema.authStrategy.id,
            set: { enabled, updatedAt: new Date() },
          });

        return { success: true };
      }),
  });
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;

// Compile-time validation: ensure router implements the RPC contract
type _ValidateContract = AuthRpcContract extends AuthRouter
  ? never
  : "Router does not implement AuthRpcContract";
