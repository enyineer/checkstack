import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  createBackendPlugin,
  authenticationStrategyServiceRef,
  type AuthStrategy,
} from "@checkmate/backend-api";
import { coreServices } from "@checkmate/backend-api";
import { userInfoRef } from "./services/user-info";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";
import { hashPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkmate/backend-api";
import { enrichUser } from "./utils/user";
import { permissionList } from "@checkmate/auth-common";
import { createAuthRouter } from "./router";

export interface BetterAuthExtensionPoint {
  addStrategy(strategy: AuthStrategy<unknown>): void;
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

    const strategies: AuthStrategy<unknown>[] = [];

    // Permission registry to track currently active permissions
    const activePermissions: { id: string; description?: string }[] = [];

    // Strategy registry
    const strategyRegistry = {
      getStrategies: () => strategies,
    };

    // Permission registry
    const permissionRegistry = {
      getPermissions: () => activePermissions,
    };

    env.registerPermissions(permissionList);

    env.registerExtensionPoint(betterAuthExtensionPoint, {
      addStrategy: (s) => strategies.push(s),
    });

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

        const session = await auth.api.getSession({
          headers,
        });
        if (!session?.user) return;
        return enrichUserLocal(session.user);
      },
    });

    // 2. Register Authentication Strategy (used by Core AuthService)
    env.registerService(authenticationStrategyServiceRef, {
      validate: async (request: Request) => {
        if (!auth) {
          return; // Not initialized yet
        }

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
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        auth: coreServices.auth,
        config: coreServices.config,
      },
      init: async ({ database, rpc, logger, auth: _auth, config }) => {
        logger.info("[auth-backend] Initializing Auth Backend...");

        db = database;

        // Function to initialize/reinitialize better-auth
        const initializeBetterAuth = async () => {
          const socialProviders: Record<string, unknown> = {};

          for (const strategy of strategies) {
            logger.info(
              `[auth-backend]    -> Adding auth strategy: ${strategy.id}`
            );

            // Skip credential strategy - it's built into better-auth
            if (strategy.id === "credential") continue;

            // Load config from ConfigService
            const strategyConfig = await config.get(
              strategy.id,
              strategy.configSchema,
              strategy.configVersion,
              strategy.migrations
            );

            // Skip if no config or disabled
            if (!strategyConfig) {
              logger.info(
                `[auth-backend]    -> Strategy ${strategy.id} has no config, skipping`
              );
              continue;
            }

            // Check if strategy is enabled (if config includes an 'enabled' field)
            const configRecord = strategyConfig as Record<string, unknown>;
            if ("enabled" in configRecord && configRecord.enabled === false) {
              logger.info(
                `[auth-backend]    -> Strategy ${strategy.id} is disabled, skipping`
              );
              continue;
            }

            // Add to socialProviders (secrets are already decrypted by ConfigService)
            socialProviders[strategy.id] = strategyConfig;
          }

          // Check if credential strategy is enabled (default to true)
          const credentialStrategy = strategies.find(
            (s) => s.id === "credential"
          );
          const credentialConfig = credentialStrategy
            ? await config.get(
                "credential",
                credentialStrategy.configSchema,
                credentialStrategy.configVersion,
                credentialStrategy.migrations
              )
            : undefined;

          const credentialConfigRecord = credentialConfig as
            | Record<string, unknown>
            | undefined;
          const credentialEnabled = credentialConfigRecord?.enabled !== false;

          return betterAuth({
            database: drizzleAdapter(database, {
              provider: "pg",
              schema: { ...schema },
            }),
            emailAndPassword: { enabled: credentialEnabled },
            socialProviders,
            basePath: "/api/auth-backend",
            baseURL: process.env.VITE_API_BASE_URL || "http://localhost:3000",
            trustedOrigins: [
              process.env.FRONTEND_URL || "http://localhost:5173",
            ],
          });
        };

        // Initialize better-auth
        auth = await initializeBetterAuth();

        // Reload function for dynamic auth config changes
        const reloadAuth = async () => {
          logger.info(
            "[auth-backend] Reloading authentication configuration..."
          );
          auth = await initializeBetterAuth();
          logger.info("[auth-backend] ✅ Authentication reloaded successfully");
        };

        // Sync permissions to database
        logger.info("🔑 Syncing permissions to database...");
        // Note: Permissions are collected via PluginManager.registerPermissions
        // We need to get them from the plugin manager's collection
        // For now, we'll seed our own permissions
        const authPermissions = permissionList.map((p) => ({
          id: `auth-backend.${p.id}`,
          description: p.description,
        }));

        // Upsert permissions into database
        for (const perm of authPermissions) {
          const existing = await database
            .select()
            .from(schema.permission)
            .where(eq(schema.permission.id, perm.id));

          if (existing.length === 0) {
            await database.insert(schema.permission).values(perm);
            logger.debug(`   -> Created permission: ${perm.id}`);
          } else {
            // Update description if changed
            await database
              .update(schema.permission)
              .set({ description: perm.description })
              .where(eq(schema.permission.id, perm.id));
          }

          // Add to active permissions registry
          activePermissions.push(perm);
        }

        logger.info(
          `   -> Synced ${authPermissions.length} permissions from auth-backend`
        );

        // Assign all permissions to admin role during seed
        const adminRolePermissions = await database
          .select()
          .from(schema.rolePermission)
          .where(eq(schema.rolePermission.roleId, "admin"));

        for (const perm of authPermissions) {
          const hasPermission = adminRolePermissions.some(
            (rp) => rp.permissionId === perm.id
          );

          if (!hasPermission) {
            await database.insert(schema.rolePermission).values({
              roleId: "admin",
              permissionId: perm.id,
            });
            logger.debug(`   -> Assigned permission ${perm.id} to admin role`);
          }
        }

        // 4. Register oRPC router
        const authRouter = createAuthRouter(
          database as NodePgDatabase<typeof schema>,
          strategyRegistry,
          reloadAuth,
          config,
          permissionRegistry
        );
        rpc.registerRouter("auth-backend", authRouter);

        // 5. Register Better Auth native handler
        rpc.registerHttpHandler("/api/auth-backend", (req) =>
          auth!.handler(req)
        );

        // All auth management endpoints are now via oRPC (see ./router.ts)

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
