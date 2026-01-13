import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  createBackendPlugin,
  coreServices,
  coreHooks,
  authenticationStrategyServiceRef,
  type AuthStrategy,
} from "@checkstack/backend-api";
import {
  pluginMetadata,
  authAccessRules,
  authAccess,
  authContract,
  authRoutes,
} from "@checkstack/auth-common";
import { NotificationApi } from "@checkstack/notification-common";
import * as schema from "./schema";
import { eq, inArray, or } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkstack/backend-api";
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
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";

export interface BetterAuthExtensionPoint {
  addStrategy(strategy: AuthStrategy<unknown>): void;
}

export const betterAuthExtensionPoint =
  createExtensionPoint<BetterAuthExtensionPoint>(
    "auth.betterAuthExtensionPoint"
  );

/**
 * Sync access rules to database and assign to admin role.
 * @param fullSync - If true, also performs orphan cleanup and default role sync.
 *                   Should only be true when syncing ALL access rules (not per-plugin hooks).
 */
async function syncAccessRulesToDb({
  database,
  logger,
  accessRules,
  fullSync = false,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: {
    id: string;
    description?: string;
    isDefault?: boolean;
    isPublic?: boolean;
  }[];
  fullSync?: boolean;
}) {
  logger.debug(`🔑 Syncing ${accessRules.length} access rules to database...`);

  for (const rule of accessRules) {
    // Map AccessRule fields to DB fields
    const dbRecord = {
      id: rule.id,
      description: rule.description,
      isAuthenticatedDefault: rule.isDefault,
      isPublicDefault: rule.isPublic,
    };
    const existing = await database
      .select()
      .from(schema.accessRule)
      .where(eq(schema.accessRule.id, rule.id));

    if (existing.length === 0) {
      await database.insert(schema.accessRule).values(dbRecord);
      logger.debug(`   -> Created access rule: ${rule.id}`);
    } else {
      await database
        .update(schema.accessRule)
        .set({ description: rule.description })
        .where(eq(schema.accessRule.id, rule.id));
    }
  }

  // Assign all access rules to admin role
  const adminRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "admin"));

  for (const rule of accessRules) {
    const hasAccess = adminRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id
    );

    if (!hasAccess) {
      await database
        .insert(schema.roleAccessRule)
        .values({
          roleId: "admin",
          accessRuleId: rule.id,
        })
        .onConflictDoNothing();
      logger.debug(`   -> Assigned access rule ${rule.id} to admin role`);
    }
  }

  // Only perform orphan cleanup and default sync when doing a full sync
  // (i.e., when we have ALL access rules, not just one plugin's access rules from a hook)
  if (!fullSync) {
    return;
  }

  // Cleanup orphan access rules (no longer registered by any plugin)
  const registeredIds = new Set(accessRules.map((r) => r.id));
  const allDbAccessRules = await database.select().from(schema.accessRule);
  const orphanAccessRules = allDbAccessRules.filter(
    (p) => !registeredIds.has(p.id)
  );

  if (orphanAccessRules.length > 0) {
    logger.debug(
      `🧹 Removing ${orphanAccessRules.length} orphan access rule(s)...`
    );
    for (const orphan of orphanAccessRules) {
      // Delete role_access_rule entries first (FK doesn't cascade)
      await database
        .delete(schema.roleAccessRule)
        .where(eq(schema.roleAccessRule.accessRuleId, orphan.id));
      // Then delete the access rule itself
      await database
        .delete(schema.accessRule)
        .where(eq(schema.accessRule.id, orphan.id));
      logger.debug(`   -> Removed orphan access rule: ${orphan.id}`);
    }
  }

  // Sync authenticated default access rules to users role
  await syncAuthenticatedDefaultAccessRulesToUsersRole({
    database,
    logger,
    accessRules,
  });

  // Sync public default access rules to anonymous role
  await syncPublicDefaultAccessRulesToAnonymousRole({
    database,
    logger,
    accessRules,
  });
}

/**
 * Sync authenticated default access rules (isAuthenticatedDefault=true) to the "users" role.
 * Respects admin-disabled defaults stored in disabled_default_access_rule table.
 */
async function syncAuthenticatedDefaultAccessRulesToUsersRole({
  database,
  logger,
  accessRules,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: { id: string; isDefault?: boolean }[];
}) {
  // Debug: log all access rules with their isDefault status
  logger.debug(
    `[DEBUG] All access rules received (${accessRules.length} total):`
  );
  for (const r of accessRules) {
    logger.debug(`   -> ${r.id}: isDefault=${r.isDefault}`);
  }

  const defaultRules = accessRules.filter((r) => r.isDefault);
  logger.debug(
    `👥 Found ${defaultRules.length} authenticated default access rules to sync to users role`
  );
  if (defaultRules.length === 0) {
    logger.debug(
      `   -> No authenticated default access rules found, skipping sync`
    );
    return;
  }

  // Get already disabled defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledDefaultAccessRule);
  const disabledIds = new Set(disabledDefaults.map((d) => d.accessRuleId));

  // Get current users role access rules
  const usersRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "users"));

  for (const rule of defaultRules) {
    // Skip if admin has disabled this default
    if (disabledIds.has(rule.id)) {
      logger.debug(`   -> Skipping disabled authenticated default: ${rule.id}`);
      continue;
    }

    const hasAccess = usersRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id
    );

    if (!hasAccess) {
      await database.insert(schema.roleAccessRule).values({
        roleId: "users",
        accessRuleId: rule.id,
      });
      logger.debug(
        `   -> Assigned authenticated default access rule ${rule.id} to users role`
      );
    }
  }
}

/**
 * Sync public default access rules (isPublic=true) to the "anonymous" role.
 * Respects admin-disabled defaults stored in disabled_public_default_access_rule table.
 */
async function syncPublicDefaultAccessRulesToAnonymousRole({
  database,
  logger,
  accessRules,
}: {
  database: NodePgDatabase<typeof schema>;
  logger: { debug: (msg: string) => void };
  accessRules: { id: string; isPublic?: boolean }[];
}) {
  const publicDefaults = accessRules.filter((r) => r.isPublic);
  logger.debug(
    `🌐 Found ${publicDefaults.length} public default access rules to sync to anonymous role`
  );
  if (publicDefaults.length === 0) {
    logger.debug(`   -> No public default access rules found, skipping sync`);
    return;
  }

  // Get already disabled public defaults (admin has removed them)
  const disabledDefaults = await database
    .select()
    .from(schema.disabledPublicDefaultAccessRule);
  const disabledIds = new Set(disabledDefaults.map((d) => d.accessRuleId));

  // Get current anonymous role access rules
  const anonymousRoleAccessRules = await database
    .select()
    .from(schema.roleAccessRule)
    .where(eq(schema.roleAccessRule.roleId, "anonymous"));

  for (const rule of publicDefaults) {
    // Skip if admin has disabled this public default
    if (disabledIds.has(rule.id)) {
      logger.debug(`   -> Skipping disabled public default: ${rule.id}`);
      continue;
    }

    const hasAccess = anonymousRoleAccessRules.some(
      (rp) => rp.accessRuleId === rule.id
    );

    if (!hasAccess) {
      await database.insert(schema.roleAccessRule).values({
        roleId: "anonymous",
        accessRuleId: rule.id,
      });
      logger.debug(
        `   -> Assigned public default access rule ${rule.id} to anonymous role`
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

    // Access rule registry - gets all access rules from PluginManager
    const accessRuleRegistry = {
      getAccessRules: () => {
        // Get all access rules from the central PluginManager registry
        return env.pluginManager.getAllAccessRules();
      },
    };

    env.registerAccessRules(authAccessRules);

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

    // Helper to fetch access rules
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

                  // Fetch roles and compute access rules for the application
                  const appRoles = await db
                    .select({ roleId: schema.applicationRole.roleId })
                    .from(schema.applicationRole)
                    .where(
                      eq(schema.applicationRole.applicationId, applicationId)
                    );

                  const roleIds = appRoles.map((r) => r.roleId);

                  // Get access rules for these roles
                  let accessRulesArray: string[] = [];
                  if (roleIds.length > 0) {
                    const rolePerms = await db
                      .select({
                        accessRuleId: schema.roleAccessRule.accessRuleId,
                      })
                      .from(schema.roleAccessRule)
                      .where(inArray(schema.roleAccessRule.roleId, roleIds));

                    accessRulesArray = [
                      ...new Set(rolePerms.map((rp) => rp.accessRuleId)),
                    ];
                  }

                  // Get team memberships for this application
                  const appTeams = await db
                    .select({ teamId: schema.applicationTeam.teamId })
                    .from(schema.applicationTeam)
                    .where(
                      eq(schema.applicationTeam.applicationId, applicationId)
                    );
                  const teamIds = appTeams.map((t) => t.teamId);

                  // Return ApplicationUser
                  return {
                    type: "application" as const,
                    id: app.id,
                    name: app.name,
                    roles: roleIds,
                    accessRulesArray,
                    teamIds,
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
                  process.env.BASE_URL || "http://localhost:5173";
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
            baseURL: process.env.BASE_URL || "http://localhost:5173",
            trustedOrigins: [process.env.BASE_URL || "http://localhost:5173"],
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

        // IMPORTANT: Seed roles BEFORE syncing access rules so default perms can be assigned
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

        // Seed "users" role for default access rules
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
            description: "Access rules for unauthenticated (anonymous) users",
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

        // Note: Access rule sync happens in afterPluginsReady (when all plugins have registered)

        // 4. Register oRPC router
        const authRouter = createAuthRouter(
          database as NodePgDatabase<typeof schema>,
          strategyRegistry,
          reloadAuth,
          config,
          accessRuleRegistry
        );
        rpc.registerRouter(authRouter, authContract);

        // 5. Register Better Auth native handler
        rpc.registerHttpHandler((req: Request) => auth!.handler(req));

        // All auth management endpoints are now via oRPC (see ./router.ts)

        // 5. Idempotent Admin User Seeding (roles already seeded above)
        const adminId = "initial-admin-id";
        const existingAdmin = await database
          .select()
          .from(schema.user)
          .where(
            or(
              eq(schema.user.email, "admin@checkstack.dev"),
              eq(schema.user.id, adminId)
            )
          );

        // Skip seeding if user exists by either email or ID
        if (existingAdmin.length === 0) {
          await database.insert(schema.user).values({
            id: adminId,
            name: "Admin",
            email: "admin@checkstack.dev",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const hashedAdminPassword = await hashPassword("admin");
          await database.insert(schema.account).values({
            id: "initial-admin-account-id",
            accountId: "admin@checkstack.dev",
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
            "   -> Created initial admin user (admin@checkstack.dev : admin)"
          );
        }

        // Register command palette commands
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "users",
              title: "Manage Users",
              subtitle: "View and manage platform users",
              iconName: "Users",
              shortcuts: ["meta+shift+u", "ctrl+shift+u"],
              route: resolveRoute(authRoutes.routes.settings) + "?tab=users",
              requiredAccessRules: [authAccess.users.read],
            },
            {
              id: "createUser",
              title: "Create User",
              subtitle: "Create a new user account",
              iconName: "UserPlus",
              route:
                resolveRoute(authRoutes.routes.settings) +
                "?tab=users&action=create",
              requiredAccessRules: [authAccess.users.create],
            },
            {
              id: "roles",
              title: "Manage Roles",
              subtitle: "Manage roles and access rules",
              iconName: "Shield",
              route: resolveRoute(authRoutes.routes.settings) + "?tab=roles",
              requiredAccessRules: [authAccess.roles.read],
            },
            {
              id: "applications",
              title: "Manage Applications",
              subtitle: "Manage external API applications",
              iconName: "Key",
              route:
                resolveRoute(authRoutes.routes.settings) + "?tab=applications",
              requiredAccessRules: [authAccess.applications],
            },
          ],
        });

        logger.debug("✅ Auth Backend initialized.");
      },
      // Phase 3: After all plugins are ready - sync all access rules including defaults
      afterPluginsReady: async ({ database, logger, onHook }) => {
        // Now that all plugins are ready, sync access rules including defaults
        // This is critical because during init, other plugins haven't registered yet
        const allAccessRules = accessRuleRegistry.getAccessRules();
        logger.debug(
          `[auth-backend] afterPluginsReady: syncing ${allAccessRules.length} access rules from all plugins`
        );
        await syncAccessRulesToDb({
          database: database as NodePgDatabase<typeof schema>,
          logger,
          accessRules: allAccessRules,
          fullSync: true,
        });

        // Subscribe to access rule registration hook for future registrations
        // This syncs new access rules when other plugins register them dynamically
        onHook(
          coreHooks.accessRulesRegistered,
          async ({ accessRules }) => {
            await syncAccessRulesToDb({
              database: database as NodePgDatabase<typeof schema>,
              logger,
              accessRules,
            });
          },
          {
            mode: "work-queue",
            workerGroup: "access-rule-db-sync",
            maxRetries: 5,
          }
        );

        // Subscribe to plugin deregistered hook for access rule cleanup
        // When a plugin is removed at runtime, delete its access rules from DB
        onHook(
          coreHooks.pluginDeregistered,
          async ({ pluginId }) => {
            logger.debug(
              `[auth-backend] Cleaning up access rules for deregistered plugin: ${pluginId}`
            );

            // Delete all access rules with this plugin's prefix
            const allDbAccessRules = await database
              .select()
              .from(schema.accessRule);
            const pluginAccessRules = allDbAccessRules.filter((p) =>
              p.id.startsWith(`${pluginId}.`)
            );

            for (const perm of pluginAccessRules) {
              // Delete role_access_rule entries first
              await database
                .delete(schema.roleAccessRule)
                .where(eq(schema.roleAccessRule.accessRuleId, perm.id));
              // Then delete the access rule itself
              await database
                .delete(schema.accessRule)
                .where(eq(schema.accessRule.id, perm.id));
              logger.debug(`   -> Removed access rule: ${perm.id}`);
            }

            logger.debug(
              `[auth-backend] Cleaned up ${pluginAccessRules.length} access rules for ${pluginId}`
            );
          },
          {
            mode: "work-queue",
            workerGroup: "access-rule-cleanup",
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
