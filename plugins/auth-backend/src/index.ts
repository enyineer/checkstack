import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  createBackendPlugin,
  authenticationStrategyServiceRef,
  type AuthStrategy,
} from "@checkmate/backend-api";
import { coreServices, coreHooks } from "@checkmate/backend-api";
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
import { validateStrategySchema } from "./utils/validate-schema";
import {
  strategyMetaConfigV1,
  STRATEGY_META_CONFIG_VERSION,
} from "./meta-config";
import {
  platformRegistrationConfigV1,
  PLATFORM_REGISTRATION_CONFIG_VERSION,
  PLATFORM_REGISTRATION_CONFIG_ID,
} from "./platform-registration-config";

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

    // Strategy registry
    const strategyRegistry = {
      getStrategies: () => strategies,
    };

    // Permission registry - gets all permissions from PluginManager
    const permissionRegistry = {
      getPermissions: () => {
        // Get all permissions from the central PluginManager registry
        return env.pluginManager.getAllPermissions();
      },
    };

    env.registerPermissions(permissionList);

    // Helper function (will be defined in init)
    let syncPermissionsToDb:
      | ((permissions: { id: string; description?: string }[]) => Promise<void>)
      | undefined;

    // Subscribe to permission registration hook (work-queue mode = only one instance syncs)
    env.onHook(
      coreHooks.permissionsRegistered,
      async ({ permissions }) => {
        // Only sync if database is ready and function is initialized
        if (!db || !syncPermissionsToDb) {
          return; // Will be synced during initial init
        }

        // Sync new permissions to database
        await syncPermissionsToDb(permissions);
      },
      {
        mode: "work-queue",
        workerGroup: "permission-db-sync",
        maxRetries: 5,
      }
    );

    env.registerExtensionPoint(betterAuthExtensionPoint, {
      addStrategy: (s) => {
        // Validate that the strategy schema doesn't have required fields without defaults
        try {
          validateStrategySchema(s.configSchema, s.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to register authentication strategy "${s.id}": ${message}`
          );
        }
        strategies.push(s);
      },
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
        logger.debug("[auth-backend] Initializing Auth Backend...");

        db = database;

        // Function to initialize/reinitialize better-auth
        const initializeBetterAuth = async () => {
          const socialProviders: Record<string, unknown> = {};
          logger.debug(
            `[auth-backend] Processing ${strategies.length} strategies...`
          );

          for (const strategy of strategies) {
            logger.debug(
              `[auth-backend]    -> Processing auth strategy: ${strategy.id}`
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

            // Check if strategy is enabled from meta config
            const metaConfig = await config.get(
              `${strategy.id}.meta`,
              strategyMetaConfigV1,
              STRATEGY_META_CONFIG_VERSION
            );
            const enabled = metaConfig?.enabled ?? false;

            if (!enabled) {
              logger.debug(
                `[auth-backend]    -> Strategy ${strategy.id} is disabled, skipping`
              );
              continue;
            }

            // Add to socialProviders (secrets are already decrypted by ConfigService)
            logger.debug(
              `[auth-backend]    -> Config keys for ${
                strategy.id
              }: ${Object.keys(strategyConfig || {}).join(", ")}`
            );
            socialProviders[strategy.id] = strategyConfig;
            logger.debug(
              `[auth-backend]    -> ✅ Added ${strategy.id} to socialProviders`
            );
          }

          // Check if credential strategy is enabled from meta config
          const credentialStrategy = strategies.find(
            (s) => s.id === "credential"
          );
          const credentialMetaConfig = credentialStrategy
            ? await config.get(
                "credential.meta",
                strategyMetaConfigV1,
                STRATEGY_META_CONFIG_VERSION
              )
            : undefined;
          // Default to true on fresh installs (no meta config)
          const credentialEnabled = credentialMetaConfig?.enabled ?? true;

          // Check platform registration setting
          const platformRegistrationConfig = await config.get(
            PLATFORM_REGISTRATION_CONFIG_ID,
            platformRegistrationConfigV1,
            PLATFORM_REGISTRATION_CONFIG_VERSION
          );
          const registrationAllowed =
            platformRegistrationConfig?.allowRegistration ?? true;

          logger.debug(
            `[auth-backend] Initializing Better Auth with ${
              Object.keys(socialProviders).length
            } social providers: ${Object.keys(socialProviders).join(", ")}`
          );

          return betterAuth({
            database: drizzleAdapter(database, {
              provider: "pg",
              schema: { ...schema },
            }),
            emailAndPassword: {
              enabled: credentialEnabled,
              disableSignUp: !registrationAllowed, // Disable signup when registration is not allowed
            },
            socialProviders,
            basePath: "/api/auth-backend",
            baseURL: process.env.VITE_API_BASE_URL || "http://localhost:3000",
            trustedOrigins: [
              process.env.VITE_FRONTEND_URL || "http://localhost:5173",
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

        // Assign the sync function so it's available to the hook listener
        syncPermissionsToDb = async (
          permissions: { id: string; description?: string }[]
        ) => {
          logger.debug(
            `🔑 Syncing ${permissions.length} permissions to database...`
          );

          for (const perm of permissions) {
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
          }

          // Assign all permissions to admin role
          const adminRolePermissions = await database
            .select()
            .from(schema.rolePermission)
            .where(eq(schema.rolePermission.roleId, "admin"));

          for (const perm of permissions) {
            const hasPermission = adminRolePermissions.some(
              (rp) => rp.permissionId === perm.id
            );

            if (!hasPermission) {
              await database.insert(schema.rolePermission).values({
                roleId: "admin",
                permissionId: perm.id,
              });
              logger.debug(
                `   -> Assigned permission ${perm.id} to admin role`
              );
            }
          }
        };

        // Initial sync of all registered permissions
        const allPermissions = permissionRegistry.getPermissions();
        await syncPermissionsToDb(allPermissions);
        logger.debug(
          `   -> Synced ${allPermissions.length} permissions from all plugins`
        );

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
        logger.debug("🌱 Checking for initial admin user...");
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

        logger.debug("✅ Auth Backend initialized.");
      },
    });
  },
});
