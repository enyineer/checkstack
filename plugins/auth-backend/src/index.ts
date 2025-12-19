import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createBackendPlugin } from "@checkmate/backend-api";
import { coreServices } from "@checkmate/backend-api";
import { userInfoRef } from "./services/user-info";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";

export default createBackendPlugin({
  pluginId: "auth-backend",
  register(env) {
    let auth: ReturnType<typeof betterAuth> | undefined;
    let db: NodePgDatabase<typeof schema> | undefined;

    // Helper to fetch permissions
    const enrichUser = async (user: User) => {
      if (!db) return user;

      // 1. Get Roles
      const userRoles = await db
        .select({
          roleName: schema.role.name,
          roleId: schema.role.id,
        })
        .from(schema.userRole)
        .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
        .where(eq(schema.userRole.userId, user.id));

      const roles = userRoles.map((r) => r.roleId);
      const permissions = new Set<string>();

      // 2. Get Permissions for each role
      for (const roleId of roles) {
        if (roleId === "admin") {
          permissions.add("*");
          continue;
        }

        const rolePermissions = await db
          .select({
            permissionId: schema.permission.id,
          })
          .from(schema.rolePermission)
          .innerJoin(
            schema.permission,
            eq(schema.permission.id, schema.rolePermission.permissionId)
          )
          .where(eq(schema.rolePermission.roleId, roleId));

        for (const p of rolePermissions) {
          permissions.add(p.permissionId);
        }
      }

      return {
        ...user,
        roles,
        permissions: [...permissions],
      };
    };

    // 1. Register User Info Service
    env.registerService(userInfoRef, {
      getUser: async (headers: Headers) => {
        if (!auth) {
          throw new Error("Auth backend not initialized");
        }
        const session = await auth.api.getSession({
          headers,
        });
        if (!session?.user) return;
        return enrichUser(session.user);
      },
    });

    // 2. Register Authentication Strategy (for Core Middleware)
    env.registerService(coreServices.authentication, {
      validate: async (request: Request) => {
        if (!auth) {
          return; // Not initialized yet
        }
        // better-auth needs headers to validate session
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) return;
        return enrichUser(session.user);
      },
    });

    // 3. Register Init logic
    env.registerInit({
      schema,
      deps: {
        database: coreServices.database,
        router: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      init: async ({ database, router, logger }) => {
        logger.info("Initializing Auth Backend...");

        auth = betterAuth({
          database: drizzleAdapter(database, {
            provider: "pg",
            schema: { ...schema },
          }),
          emailAndPassword: { enabled: true },
        });

        router.on(["POST", "GET"], "/*", (c) => {
          return auth!.handler(c.req.raw);
        });

        logger.info("✅ Auth Backend initialized.");
      },
    });
  },
});
