import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createBackendPlugin } from "@checkmate/backend-api";
import { coreServices } from "@checkmate/backend-api";
import { userInfoRef } from "./services/user-info";
import * as schema from "./schema";
import { eq, inArray } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";
import { hashPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkmate/backend-api";
import { enrichUser } from "./utils/user";
import {
  permissionList,
  permissions as authPermissions,
} from "@checkmate/auth-common";

export interface BetterAuthStrategy {
  id: string;
  config: Record<string, unknown>;
}

export interface BetterAuthExtensionPoint {
  addStrategy(strategy: BetterAuthStrategy): void;
}

export const betterAuthExtensionPoint =
  createExtensionPoint<BetterAuthExtensionPoint>(
    "auth.betterAuthExtensionPoint"
  );

export default createBackendPlugin({
  pluginId: "auth-backend",
  register(env) {
    let auth: ReturnType<typeof betterAuth> | undefined;
    let db: NodePgDatabase<typeof schema> | undefined;
    let tokenVerification:
      | import("@checkmate/backend-api").TokenVerification
      | undefined;

    const strategies: BetterAuthStrategy[] = [];

    env.registerPermissions(permissionList);

    env.registerExtensionPoint(betterAuthExtensionPoint, {
      addStrategy: (s) => strategies.push(s),
    });

    // Helper: Verify Service Token
    const verifyServiceToken = async (
      headers: Headers
    ): Promise<
      | {
          id: string;
          permissions: string[];
          roles: string[];
        }
      | undefined
    > => {
      if (!tokenVerification) return undefined;

      const authHeader = headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return undefined;

      const token = authHeader.split(" ")[1];
      try {
        const payload = await tokenVerification.verify(token);
        if (!payload) return undefined;

        // It's a valid service token
        return {
          id: (payload.sub as string) || "service",
          permissions: ["*"], // Grant all permissions
          roles: ["service"],
        };
      } catch {
        return undefined;
      }
    };

    // Helper to fetch permissions
    const enrichUserLocal = async (user: User) => {
      if (!db) return user;
      return enrichUser(user, db);
    };

    // 1. Register User Info Service
    env.registerService(userInfoRef, {
      getUser: async (headers: Headers) => {
        if (!auth) {
          throw new Error("Auth backend not initialized");
        }

        // Try Service Token First
        const serviceUser = await verifyServiceToken(headers);
        if (serviceUser) return serviceUser;

        const session = await auth.api.getSession({
          headers,
        });
        if (!session?.user) return;
        return enrichUserLocal(session.user);
      },
    });

    // 2. Register Authentication Strategy (for Core Middleware)
    env.registerService(coreServices.authentication, {
      validate: async (request: Request) => {
        if (!auth) {
          return; // Not initialized yet
        }

        // Try Service Token First
        const serviceUser = await verifyServiceToken(request.headers);
        if (serviceUser) return serviceUser;

        // better-auth needs headers to validate session
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) return;
        return enrichUserLocal(session.user);
      },
    });

    // 3. Register Init logic
    env.registerInit({
      schema,
      deps: {
        database: coreServices.database,
        router: coreServices.httpRouter,
        logger: coreServices.logger,
        tokenVerification: coreServices.tokenVerification,
        check: coreServices.permissionCheck,
        validate: coreServices.validation,
      },
      init: async ({
        database,
        router,
        logger,
        tokenVerification: tv,
        check,
        validate: _validate,
      }) => {
        logger.info("Initializing Auth Backend...");

        db = database;
        tokenVerification = tv;

        // Fetch enabled strategies
        const dbStrategies = await database.select().from(schema.authStrategy);
        const isDisabled = (id: string) =>
          dbStrategies.find((s) => s.id === id)?.enabled === false;

        const socialProviders: Record<string, unknown> = {};
        for (const s of strategies) {
          if (isDisabled(s.id)) {
            logger.info(`   -> Auth strategy DISABLED: ${s.id}`);
            continue;
          }
          logger.info(`   -> Adding auth strategy: ${s.id}`);
          socialProviders[s.id] = s.config;
        }

        auth = betterAuth({
          database: drizzleAdapter(database, {
            provider: "pg",
            schema: { ...schema },
          }),
          emailAndPassword: { enabled: !isDisabled("credential") },
          socialProviders,
          basePath: "/api/auth-backend",
          baseURL: process.env.VITE_API_BASE_URL || "http://localhost:3000",
          trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:5173"],
        });

        // 4. Register permissions endpoint (BEFORE catch-all)
        router.get("/permissions", async (c) => {
          const session = await auth!.api.getSession({
            headers: c.req.raw.headers,
          });

          if (!session?.user) {
            return c.json({ error: "Unauthorized" }, 401);
          }

          const enrichedUser = await enrichUserLocal(session.user);
          const permissions =
            "permissions" in enrichedUser ? enrichedUser.permissions : [];
          return c.json({ permissions });
        });

        // 5. User Management APIs
        router.get("/users", check(authPermissions.usersRead.id), async (c) => {
          const users = await database.select().from(schema.user);
          const userRoles = await database
            .select()
            .from(schema.userRole)
            .where(
              inArray(
                schema.userRole.userId,
                users.map((u) => u.id)
              )
            );

          const usersWithRoles = users.map((u) => ({
            ...u,
            roles: userRoles
              .filter((ur) => ur.userId === u.id)
              .map((ur) => ur.roleId),
          }));

          return c.json(usersWithRoles);
        });

        router.delete(
          "/users/:id",
          check(authPermissions.usersManage.id),
          async (c) => {
            const id = c.req.param("id");
            if (id === "initial-admin-id") {
              return c.json({ error: "Cannot delete initial admin" }, 403);
            }
            await database.delete(schema.user).where(eq(schema.user.id, id));
            return c.json({ success: true });
          }
        );

        router.get(
          "/roles",
          check(authPermissions.rolesManage.id),
          async (c) => {
            const roles = await database.select().from(schema.role);
            return c.json(roles);
          }
        );

        router.post(
          "/users/:id/roles",
          check(authPermissions.rolesManage.id),
          async (c) => {
            const userId = c.req.param("id");
            const { roles } = (await c.req.json()) as { roles: string[] };

            await database.transaction(async (tx) => {
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

            return c.json({ success: true });
          }
        );

        router.get(
          "/strategies",
          check(authPermissions.strategiesManage.id),
          async (c) => {
            const dbStrategies = await database
              .select()
              .from(schema.authStrategy);
            const result = strategies.map((s) => {
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
                dbStrategies.find((ds) => ds.id === "credential")?.enabled ??
                true,
            });
            return c.json(result);
          }
        );

        router.patch(
          "/strategies/:id",
          check(authPermissions.strategiesManage.id),
          async (c) => {
            const id = c.req.param("id");
            const { enabled } = (await c.req.json()) as { enabled: boolean };

            await database
              .insert(schema.authStrategy)
              .values({ id, enabled })
              .onConflictDoUpdate({
                target: schema.authStrategy.id,
                set: { enabled, updatedAt: new Date() },
              });

            return c.json({ success: true });
          }
        );

        router.all("*", (c) => {
          return auth!.handler(c.req.raw);
        });

        // 4. Idempotent Seeding
        logger.info("🌱 Checking for initial admin user...");
        const adminRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "admin"));
        if (adminRole.length === 0) {
          await database.insert(schema.role).values({
            id: "admin",
            name: "Administrator",
            isSystem: true,
          });
          logger.info("   -> Created 'admin' role.");
        }

        const adminUser = await database
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, "admin@checkmate.local"));

        if (adminUser.length === 0) {
          const adminId = "initial-admin-id";
          await database.insert(schema.user).values({
            id: adminId,
            name: "Admin",
            email: "admin@checkmate.local",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const hashedAdminPassword = await hashPassword("admin");
          await database.insert(schema.account).values({
            id: "initial-admin-account-id",
            accountId: "admin@checkmate.local",
            providerId: "credential",
            userId: adminId,
            password: hashedAdminPassword,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await database.insert(schema.userRole).values({
            userId: adminId,
            roleId: "admin",
          });

          logger.info(
            "   -> Created initial admin user (admin@checkmate.local : admin)"
          );
        }

        logger.info("✅ Auth Backend initialized.");
      },
    });
  },
});
