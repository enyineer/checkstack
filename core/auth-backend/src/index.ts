import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  createBackendPlugin,
  coreServices,
  coreHooks,
  authenticationStrategyServiceRef,
  type AuthStrategy,
} from "@checkmate-monitor/backend-api";
import {
  pluginMetadata,
  permissionList,
  authContract,
} from "@checkmate-monitor/auth-common";
import { NotificationApi } from "@checkmate-monitor/notification-common";
import * as schema from "./schema";
import { eq, inArray } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkmate-monitor/backend-api";
import { enrichUser } from "./utils/user";
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

/**
 * Sync permissions to database and assign to admin role.
 * @param fullSync - If true, also performs orphan cleanup and default role sync.
 *                   Should only be true when syncing ALL permissions (not per-plugin hooks).
 */
async function syncPermissionsToDb({
  database,
  logger,
  permissions,
  fullSync = false,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  permissions: {
    id: string;
    description?: string;
    isAuthenticatedDefault?: boolean;
    isPublicDefault?: boolean;
  }[];
  fullSync?: boolean;
}) {
  logger.debug(`🔑 Syncing ${permissions.length} permissions to database...`);

  for (const perm of permissions) {
    const existing = await database
      .select()
      .from(schema.permission)
      .where(eq(schema.permission.id, perm.id));

    if (existing.length === 0) {
      await database.insert(schema.permission).values(perm);
      logger.debug(`   -> Created permission: ${perm.id}`);
    } else {
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
      await database
        .insert(schema.rolePermission)
        .values({
          roleId: "admin",
          permissionId: perm.id,
        })
        .onConflictDoNothing();
      logger.debug(`   -> Assigned permission ${perm.id} to admin role`);
    }
  }

  // Only perform orphan cleanup and default sync when doing a full sync
  // (i.e., when we have ALL permissions, not just one plugin's permissions from a hook)
  if (!fullSync) {
    return;
  }

  // Cleanup orphan permissions (no longer registered by any plugin)
  const registeredIds = new Set(permissions.map((p) => p.id));
  const allDbPermissions = await database.select().from(schema.permission);
  const orphanPermissions = allDbPermissions.filter(
    (p) => !registeredIds.has(p.id)
  );

  if (orphanPermissions.length > 0) {
    logger.debug(
      `🧹 Removing ${orphanPermissions.length} orphan permission(s)...`
    );
    for (const orphan of orphanPermissions) {
      // Delete role_permission entries first (FK doesn't cascade)
      await database
        .delete(schema.rolePermission)
        .where(eq(schema.rolePermission.permissionId, orphan.id));
      // Then delete the permission itself
      await database
        .delete(schema.permission)
        .where(eq(schema.permission.id, orphan.id));
      logger.debug(`   -> Removed orphan permission: ${orphan.id}`);
    }
  }

  // Sync authenticated default permissions to users role
  await syncAuthenticatedDefaultPermissionsToUsersRole({
    database,
    logger,
    permissions,
  });

  // Sync public default permissions to anonymous role
  await syncPublicDefaultPermissionsToAnonymousRole({
    database,
    logger,
    permissions,
  });
}

/**
 * Sync authenticated default permissions (isAuthenticatedDefault=true) to the "users" role.
 * Respects admin-disabled defaults stored in disabled_default_permission table.
 */
async function syncAuthenticatedDefaultPermissionsToUsersRole({
  database,
  logger,
  permissions,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  permissions: { id: string; isAuthenticatedDefault?: boolean }[];
}) {
  // Debug: log all permissions with their isAuthenticatedDefault status
  logger.debug(
    `[DEBUG] All permissions received (${permissions.length} total):`
  );
  for (const p of permissions) {
    logger.debug(
      `   -> ${p.id}: isAuthenticatedDefault=${p.isAuthenticatedDefault}`
    );
  }

  const defaultPermissions = permissions.filter(
    (p) => p.isAuthenticatedDefault
  );
  logger.debug(
    `👥 Found ${defaultPermissions.length} authenticated default permissions to sync to users role`
  );
  if (defaultPermissions.length === 0) {
    logger.debug(
      `   -> No authenticated default permissions found, skipping sync`
    );
    return;
  }

  // Get already disabled defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledDefaultPermission);
  const disabledIds = new Set(disabledDefaults.map((d) => d.permissionId));

  // Get current users role permissions
  const usersRolePermissions = await database
    .select()
    .from(schema.rolePermission)
    .where(eq(schema.rolePermission.roleId, "users"));

  for (const perm of defaultPermissions) {
    // Skip if admin has disabled this default
    if (disabledIds.has(perm.id)) {
      logger.debug(`   -> Skipping disabled authenticated default: ${perm.id}`);
      continue;
    }

    const hasPermission = usersRolePermissions.some(
      (rp) => rp.permissionId === perm.id
    );

    if (!hasPermission) {
      await database.insert(schema.rolePermission).values({
        roleId: "users",
        permissionId: perm.id,
      });
      logger.debug(
        `   -> Assigned authenticated default permission ${perm.id} to users role`
      );
    }
  }
}

/**
 * Sync public default permissions (isPublicDefault=true) to the "anonymous" role.
 * Respects admin-disabled defaults stored in disabled_public_default_permission table.
 */
async function syncPublicDefaultPermissionsToAnonymousRole({
  database,
  logger,
  permissions,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  permissions: { id: string; isPublicDefault?: boolean }[];
}) {
  const publicDefaults = permissions.filter((p) => p.isPublicDefault);
  logger.debug(
    `🌐 Found ${publicDefaults.length} public default permissions to sync to anonymous role`
  );
  if (publicDefaults.length === 0) {
    logger.debug(`   -> No public default permissions found, skipping sync`);
    return;
  }

  // Get already disabled public defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledPublicDefaultPermission);
  const disabledIds = new Set(disabledDefaults.map((d) => d.permissionId));

  // Get current anonymous role permissions
  const anonymousRolePermissions = await database
    .select()
    .from(schema.rolePermission)
    .where(eq(schema.rolePermission.roleId, "anonymous"));

  for (const perm of publicDefaults) {
    // Skip if admin has disabled this public default
    if (disabledIds.has(perm.id)) {
      logger.debug(`   -> Skipping disabled public default: ${perm.id}`);
      continue;
    }

    const hasPermission = anonymousRolePermissions.some(
      (rp) => rp.permissionId === perm.id
    );

    if (!hasPermission) {
      await database.insert(schema.rolePermission).values({
        roleId: "anonymous",
        permissionId: perm.id,
      });
      logger.debug(
        `   -> Assigned public default permission ${perm.id} to anonymous role`
      );
    }
  }
}

export default createBackendPlugin({
  metadata: pluginMetadata,
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

    // 2. Register Authentication Strategy (used by Core AuthService)
    env.registerService(authenticationStrategyServiceRef, {
      validate: async (request: Request) => {
        if (!db) {
          return; // Not initialized yet
        }

        // Check for API key authentication (Bearer ck_<appId>_<secret>)
        const authHeader = request.headers.get("authorization");
        if (authHeader?.startsWith("Bearer ck_")) {
          const token = authHeader.slice(7); // Remove "Bearer "
          const parts = token.split("_");
          // Token format: ck_<uuid>_<secret>
          // Split: ["ck", "uuid-with-dashes", "secret"]
          // UUID has dashes, so we need to handle properly
          if (parts.length >= 3 && parts[0] === "ck") {
            // The UUID is parts[1] and potentially includes more parts if UUID has dashes
            // For a UUID like "abc-def-ghi", after "ck_", we get the rest split by _
            // Safer approach: find the application ID by parsing
            const tokenWithoutPrefix = token.slice(3); // Remove "ck_"
            // UUID is 36 chars, secret is 32 chars
            const applicationId = tokenWithoutPrefix.slice(0, 36);
            const secret = tokenWithoutPrefix.slice(37); // Skip the _ separator

            if (applicationId && secret) {
              // Look up application
              const apps = await db
                .select()
                .from(schema.application)
                .where(eq(schema.application.id, applicationId))
                .limit(1);

              if (apps.length > 0) {
                const app = apps[0];
                // Verify secret using bcrypt
                const isValid = await verifyPassword({
                  hash: app.secretHash,
                  password: secret,
                });

                if (isValid) {
                  // Update lastUsedAt timestamp (fire-and-forget)
                  db.update(schema.application)
                    .set({ lastUsedAt: new Date() })
                    .where(eq(schema.application.id, applicationId))
                    .execute()
                    .catch(() => {
                      // Ignore errors from lastUsedAt update
                    });

                  // Fetch roles and compute permissions for the application
                  const appRoles = await db
                    .select({ roleId: schema.applicationRole.roleId })
                    .from(schema.applicationRole)
                    .where(
                      eq(schema.applicationRole.applicationId, applicationId)
                    );

                  const roleIds = appRoles.map((r) => r.roleId);

                  // Get permissions for these roles
                  let permissions: string[] = [];
                  if (roleIds.length > 0) {
                    const rolePerms = await db
                      .select({
                        permissionId: schema.rolePermission.permissionId,
                      })
                      .from(schema.rolePermission)
                      .where(inArray(schema.rolePermission.roleId, roleIds));

                    permissions = [
                      ...new Set(rolePerms.map((rp) => rp.permissionId)),
                    ];
                  }

                  // Return ApplicationUser
                  return {
                    type: "application" as const,
                    id: app.id,
                    name: app.name,
                    roles: roleIds,
                    permissions,
                  };
                }
              }
            }
          }
          return; // Invalid API key
        }

        // Fall back to session-based authentication (better-auth)
        if (!auth) {
          return; // Not initialized yet
        }

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
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
        auth: coreServices.auth,
        config: coreServices.config,
      },
      init: async ({
        database,
        rpc,
        rpcClient,
        logger,
        auth: _auth,
        config,
      }) => {
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
              disableSignUp: !registrationAllowed,
              minPasswordLength: 8,
              maxPasswordLength: 128,
              sendResetPassword: async ({ user, url }) => {
                // Send password reset notification via all enabled strategies
                // Using void to prevent timing attacks revealing email existence
                const notificationClient = rpcClient.forPlugin(NotificationApi);
                const frontendUrl =
                  process.env.VITE_FRONTEND_URL || "http://localhost:5173";
                const resetUrl = `${frontendUrl}/auth/reset-password?token=${
                  url.split("token=")[1] ?? ""
                }`;

                void notificationClient.sendTransactional({
                  userId: user.id,
                  notification: {
                    title: "Password Reset Request",
                    body: `You requested to reset your password. Click the button below to set a new password. This link will expire in 1 hour.\n\nIf you didn't request this, please ignore this message or contact support if you're concerned.`,
                    action: {
                      label: "Reset Password",
                      url: resetUrl,
                    },
                  },
                });

                logger.debug(
                  `[auth-backend] Password reset email sent to user: ${user.id}`
                );
              },
              resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
            },
            socialProviders,
            basePath: "/api/auth",
            baseURL: process.env.VITE_API_BASE_URL || "http://localhost:3000",
            trustedOrigins: [
              process.env.VITE_FRONTEND_URL || "http://localhost:5173",
            ],
            databaseHooks: {
              user: {
                create: {
                  before: async (user) => {
                    // Block new user creation when registration is disabled
                    // Credential registration is already blocked by disableSignUp,
                    // so any user.create here must be from social providers
                    if (!registrationAllowed) {
                      throw new APIError("FORBIDDEN", {
                        message:
                          "Registration is currently disabled. Please contact an administrator.",
                      });
                    }
                    return { data: user };
                  },
                  after: async (user) => {
                    // Auto-assign "users" role to new users
                    try {
                      await database.insert(schema.userRole).values({
                        userId: user.id,
                        roleId: "users",
                      });
                      logger.debug(
                        `[auth-backend] Assigned 'users' role to new user: ${user.id}`
                      );
                    } catch (error) {
                      // Role might not exist yet on first boot, that's okay
                      logger.debug(
                        `[auth-backend] Could not assign 'users' role to ${user.id}: ${error}`
                      );
                    }
                  },
                },
              },
            },
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

        // IMPORTANT: Seed roles BEFORE syncing permissions so default perms can be assigned
        logger.debug("🌱 Checking for initial roles...");
        const adminRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "admin"));
        if (adminRole.length === 0) {
          await database.insert(schema.role).values({
            id: "admin",
            name: "Administrators",
            isSystem: true,
          });
          logger.info("   -> Created 'admin' role.");
        }

        // Seed "users" role for default permissions
        const usersRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "users"));
        if (usersRole.length === 0) {
          await database.insert(schema.role).values({
            id: "users",
            name: "Users",
            description: "Default role for all authenticated users",
            isSystem: true,
          });
          logger.info("   -> Created 'users' role.");
        }

        // Seed "anonymous" role for public access
        const anonymousRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "anonymous"));
        if (anonymousRole.length === 0) {
          await database.insert(schema.role).values({
            id: "anonymous",
            name: "Anonymous Users",
            description: "Permissions for unauthenticated (anonymous) users",
            isSystem: true,
          });
          logger.info("   -> Created 'anonymous' role.");
        }

        // Seed "applications" role for external API applications
        const applicationsRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "applications"));
        if (applicationsRole.length === 0) {
          await database.insert(schema.role).values({
            id: "applications",
            name: "Applications",
            description: "Default role for external API applications",
            isSystem: true,
          });
          logger.info("   -> Created 'applications' role.");
        }

        // Note: Permission sync happens in afterPluginsReady (when all plugins have registered)

        // 4. Register oRPC router
        const authRouter = createAuthRouter(
          database as NodePgDatabase<typeof schema>,
          strategyRegistry,
          reloadAuth,
          config,
          permissionRegistry
        );
        rpc.registerRouter(authRouter, authContract);

        // 5. Register Better Auth native handler
        rpc.registerHttpHandler((req: Request) => auth!.handler(req));

        // All auth management endpoints are now via oRPC (see ./router.ts)

        // 5. Idempotent Admin User Seeding (roles already seeded above)
        const adminUser = await database
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, "admin@checkmate-monitor.com"));

        if (adminUser.length === 0) {
          const adminId = "initial-admin-id";
          await database.insert(schema.user).values({
            id: adminId,
            name: "Admin",
            email: "admin@checkmate-monitor.com",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const hashedAdminPassword = await hashPassword("admin");
          await database.insert(schema.account).values({
            id: "initial-admin-account-id",
            accountId: "admin@checkmate-monitor.com",
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
            "   -> Created initial admin user (admin@checkmate-monitor.com : admin)"
          );
        }

        logger.debug("✅ Auth Backend initialized.");
      },
      // Phase 3: After all plugins are ready - sync all permissions including defaults
      afterPluginsReady: async ({ database, logger, onHook }) => {
        // Now that all plugins are ready, sync permissions including defaults
        // This is critical because during init, other plugins haven't registered yet
        const allPermissions = permissionRegistry.getPermissions();
        logger.debug(
          `[auth-backend] afterPluginsReady: syncing ${allPermissions.length} permissions from all plugins`
        );
        await syncPermissionsToDb({
          database: database as NodePgDatabase<typeof schema>,
          logger,
          permissions: allPermissions,
          fullSync: true,
        });

        // Subscribe to permission registration hook for future registrations
        // This syncs new permissions when other plugins register them dynamically
        onHook(
          coreHooks.permissionsRegistered,
          async ({ permissions }) => {
            await syncPermissionsToDb({
              database: database as NodePgDatabase<typeof schema>,
              logger,
              permissions,
            });
          },
          {
            mode: "work-queue",
            workerGroup: "permission-db-sync",
            maxRetries: 5,
          }
        );

        // Subscribe to plugin deregistered hook for permission cleanup
        // When a plugin is removed at runtime, delete its permissions from DB
        onHook(
          coreHooks.pluginDeregistered,
          async ({ pluginId }) => {
            logger.debug(
              `[auth-backend] Cleaning up permissions for deregistered plugin: ${pluginId}`
            );

            // Delete all permissions with this plugin's prefix
            const allDbPermissions = await database
              .select()
              .from(schema.permission);
            const pluginPermissions = allDbPermissions.filter((p) =>
              p.id.startsWith(`${pluginId}.`)
            );

            for (const perm of pluginPermissions) {
              // Delete role_permission entries first
              await database
                .delete(schema.rolePermission)
                .where(eq(schema.rolePermission.permissionId, perm.id));
              // Then delete the permission itself
              await database
                .delete(schema.permission)
                .where(eq(schema.permission.id, perm.id));
              logger.debug(`   -> Removed permission: ${perm.id}`);
            }

            logger.debug(
              `[auth-backend] Cleaned up ${pluginPermissions.length} permissions for ${pluginId}`
            );
          },
          {
            mode: "work-queue",
            workerGroup: "permission-cleanup",
            maxRetries: 3,
          }
        );

        logger.debug("✅ Auth Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export utility functions for use by custom auth strategies
export * from "./utils/auth-error-redirect";

// Re-export hooks for cross-plugin communication
export { authHooks } from "./hooks";
