import { betterAuth } from "better-auth";
import * as socialProviderFactories from "better-auth/social-providers";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { mcp } from "better-auth/plugins";
import { z } from "zod";
import {
  createBackendPlugin,
  coreServices,
  coreHooks,
  authenticationStrategyServiceRef,
  assertMigrationChainFromV1,
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
import { eq } from "drizzle-orm";
import { SafeDatabase, withScopedTransaction } from "@checkstack/backend-api";
import { BetterAuthOptions, User } from "better-auth/types";
import { verifyPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkstack/backend-api";
import {
  enrichUser,
  enrichApplicationPrincipal,
  readEnrichedUser,
} from "./utils/user";
import { createAuthRouter } from "./router";
import { validateStrategySchema } from "./utils/validate-schema";
import { USERS_ROLE_ID } from "./role-ids";
import { RoleMembershipStore } from "./role-membership-store";
import { seedSystemRoles, syncAccessRulesToDb } from "./access-rule-sync";
import { createAuthCache, type AuthCache } from "./auth-cache";
import {
  strategyMetaConfigV1,
  STRATEGY_META_CONFIG_VERSION,
} from "./meta-config";
import {
  platformRegistrationConfigV1,
  PLATFORM_REGISTRATION_CONFIG_VERSION,
  PLATFORM_REGISTRATION_CONFIG_ID,
} from "./platform-registration-config";
import {
  mcpOAuthConfigV1,
  MCP_OAUTH_CONFIG_VERSION,
  MCP_OAUTH_CONFIG_ID,
} from "./mcp-oauth-config";
import {
  narrowedPrincipalFromSession,
  introspectOpaqueToken,
  opaqueBearerToken,
} from "./oauth-branch";
import { checkRateLimit } from "./rate-limit";
import {
  createBetterAuthRateLimitStore,
  pruneExpiredBetterAuthRateLimits,
} from "./better-auth-rate-limit-store";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute, extractErrorMessage} from "@checkstack/common";

// Periodic prune of expired `better_auth_rate_limit` rows. The limiter's
// `set()` upsert never deletes, so the table grows one row per distinct
// brute-force key forever. We schedule a recurring queue job (work-queue
// consumer group) that runs the idempotent DELETE; a single consumer per fire
// runs it, and the DELETE is shared-DB so even a duplicate fire is harmless.
const RATE_LIMIT_PRUNE_QUEUE = "auth-rate-limit-prune";
const RATE_LIMIT_PRUNE_JOB_ID = "auth-rate-limit-prune-sweep";
const RATE_LIMIT_PRUNE_WORKER_GROUP = "auth-rate-limit-prune-worker";
/** Run the prune sweep hourly (cron at minute 0). */
const RATE_LIMIT_PRUNE_CRON = "0 * * * *";

/** Best-effort client IP for the DCR rate-limit key (proxy headers first). */
function clientIpOf(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export interface BetterAuthExtensionPoint {
  addStrategy(strategy: AuthStrategy<unknown>): void;
}

export const betterAuthExtensionPoint =
  createExtensionPoint<BetterAuthExtensionPoint>(
    "auth.betterAuthExtensionPoint",
  );

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    let auth: ReturnType<typeof betterAuth> | undefined;
    let db: SafeDatabase<typeof schema> | undefined;
    // Shared auth read-path cache (user->roles, role->rules, anon invalidation).
    // Set during init once the CacheManager is available; the `validate` closure
    // and the RoleMembershipStore instances read it from here.
    let authCache: AuthCache | undefined;

    const strategies: AuthStrategy<unknown>[] = [];

    // Strategy registry
    const strategyRegistry = {
      getStrategies: () => strategies,
    };

    // Access rule registry - gets all access rules from PluginManager, annotated
    // with `anonymousUsable` (whether a `public` procedure actually requires the
    // rule) so the role editor can guard anonymous-role grants.
    const accessRuleRegistry = {
      getAccessRules: () => {
        const usable = new Set(
          env.pluginManager.getAnonymousUsableAccessRuleIds(),
        );
        return env.pluginManager.getAllAccessRules().map((rule) => ({
          ...rule,
          anonymousUsable: usable.has(rule.id),
        }));
      },
      getResourceKinds: () => env.pluginManager.getResourceKinds(),
    };

    env.registerAccessRules(authAccessRules);

    env.registerExtensionPoint(betterAuthExtensionPoint, {
      addStrategy: (s) => {
        // Validate that the strategy schema doesn't have required fields without defaults
        try {
          validateStrategySchema(s.configSchema, s.id);
          // Fail fast at registration (boot) if the strategy's
          // v1->configVersion migration chain is incomplete or broken.
          // Auth's read path migrates-then-validates via
          // `configService.get(id, schema, configVersion, migrations)`, so a
          // missing covering migration would otherwise only surface LAZILY
          // on the first stale read. This guard surfaces it at boot for
          // every registered strategy exactly once — `addStrategy` is the
          // single canonical registration chokepoint (all read sites in
          // index.ts/router.ts only consume the already-registered list).
          assertMigrationChainFromV1({
            version: s.configVersion,
            migrations: s.migrations ?? [],
          });
        } catch (error) {
          const message =
            extractErrorMessage(error);
          throw new Error(
            `Failed to register authentication strategy "${s.id}": ${message}`,
          );
        }
        strategies.push(s);
      },
    });

    // Helper to fetch access rules
    const enrichUserLocal = async (user: User) => {
      if (!db || !authCache) return user;
      return enrichUser({ user, db, authCache });
    };

    // 2. Register Authentication Strategy (used by Core AuthService)
    env.registerService(authenticationStrategyServiceRef, {
      validate: async (request: Request) => {
        if (!db || !authCache) {
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
            // Token format: ck_<uuid>_<secret>
            // Parse using the known ck_ prefix and structured delimiter
            const tokenWithoutPrefix = token.slice(3); // Remove "ck_"
            // Find the last underscore: UUID may contain dashes but not underscores
            // UUID is always 36 chars (8-4-4-4-12 with dashes)
            const separatorIndex = tokenWithoutPrefix.indexOf("_", 36);
            if (separatorIndex === -1) return; // Malformed token
            const applicationId = tokenWithoutPrefix.slice(0, separatorIndex);
            const secret = tokenWithoutPrefix.slice(separatorIndex + 1);

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

                  // Resolve roles, access rules, and teams via the shared
                  // helper (same path as the app-principal token branch).
                  const enriched = await enrichApplicationPrincipal(
                    applicationId,
                    db,
                  );
                  if (!enriched) return;

                  // Return ApplicationUser
                  return {
                    type: "application" as const,
                    id: enriched.id,
                    name: enriched.name,
                    roles: enriched.roles,
                    accessRules: enriched.accessRules,
                    teamIds: enriched.teamIds,
                  };
                }
              }
            }
          }
          return; // Invalid API key
        }

        // Bearer OAuth-access-token branch (AI platform MCP / OAuth AS).
        //
        // Tokens are OPAQUE (decision §11): introspect the token against the
        // oidcProvider-owned token table, then build a principal whose access
        // rules are the token's GRANTED scopes intersected with the bound
        // user's LIVE access rules. Narrow-only, re-evaluated live every call.
        // autoAuthMiddleware remains the single enforcement point; this branch
        // only PRODUCES the narrowed principal. A miss falls through to session.
        const opaqueToken = opaqueBearerToken(request);
        if (opaqueToken) {
          // Capture the guarded `authCache` as a const so its non-undefined
          // narrowing carries into the transaction closure below (a `let` from
          // the outer scope would widen back inside a nested function).
          const resolvedAuthCache = authCache;
          // introspect -> user -> enrich -> access-rule catalog are all pure
          // DB reads, so run the whole branch under a single scoped transaction
          // (one `SET LOCAL search_path`), threading the same `tx` down into
          // `readEnrichedUser`. The enrich reads are cache-first, so on a hit
          // they touch neither the tx nor the DB.
          const narrowed = await withScopedTransaction(db, async (tx) => {
            const session = await introspectOpaqueToken({
              db: tx,
              token: opaqueToken,
            });
            if (!session) return;
            const userRow = await tx
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            if (userRow.length === 0) return;
            const base = await readEnrichedUser({
              user: userRow[0],
              runner: tx,
              authCache: resolvedAuthCache,
            });
            const catalogRows = await tx
              .select({ id: schema.accessRule.id })
              .from(schema.accessRule);
            return narrowedPrincipalFromSession({
              session,
              principal: { base, catalog: catalogRows.map((r) => r.id) },
            });
          });
          if (narrowed) return narrowed;
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
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
        queueManager: coreServices.queueManager,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({
        database,
        rpc,
        rpcClient,
        logger,
        auth: _auth,
        config,
        resourceResolverRegistry,
        queueManager,
        cacheManager,
      }) => {
        logger.debug("[auth-backend] Initializing Auth Backend...");

        db = database;
        // The shared auth read-path cache. Built on the platform CacheManager so
        // invalidation is a `delete` on the shared backend (cluster-wide with a
        // distributed provider), replacing the old broadcast-hook coherence.
        // Held in a local const too so it can be passed where TS can't narrow the
        // mutable module-level `authCache`.
        const resolvedAuthCache = createAuthCache({ cacheManager, logger });
        authCache = resolvedAuthCache;

        // Dev-auth seed: with CHECKSTACK_DEV_AUTH, every request authenticates
        // as a stable synthetic "dev-user" (see core/backend `dev-auth.ts`) that
        // has no row in this table - so any insert recording a `created_by` /
        // `user` foreign key (e.g. creating an application or a team) fails with
        // "a referenced record does not exist". Seed that row here, in the table
        // OWNER, so dev-auth is fully functional. Idempotent and strictly
        // dev-only; the production auth path never reaches this. The identity
        // MUST match the synthetic user in `dev-auth.ts` (id "dev-user").
        if (process.env.CHECKSTACK_DEV_AUTH === "true") {
          const now = new Date();
          await database
            .insert(schema.user)
            .values({
              id: "dev-user",
              name: "Dev User",
              email: "dev@checkstack.local",
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();
          logger.warn(
            "[auth-backend] Seeded synthetic dev-auth user (CHECKSTACK_DEV_AUTH).",
          );
        }

        // Function to initialize/reinitialize better-auth
        const initializeBetterAuth = async () => {
          const socialProviders: Record<string, unknown> = {};
          logger.debug(
            `[auth-backend] Processing ${strategies.length} strategies...`,
          );

          for (const strategy of strategies) {
            logger.debug(
              `[auth-backend]    -> Processing auth strategy: ${strategy.id}`,
            );

            // Skip credential strategy - it's built into better-auth
            if (strategy.id === "credential") continue;

            // Load config from ConfigService
            const strategyConfig = await config.get(
              strategy.id,
              strategy.configSchema,
              strategy.configVersion,
              strategy.migrations,
            );

            // Check if strategy is enabled from meta config
            const metaConfig = await config.get(
              `${strategy.id}.meta`,
              strategyMetaConfigV1,
              STRATEGY_META_CONFIG_VERSION,
            );
            const enabled = metaConfig?.enabled ?? false;

            if (!enabled) {
              logger.debug(
                `[auth-backend]    -> Strategy ${strategy.id} is disabled, skipping`,
              );
              continue;
            }

            // Add to socialProviders (secrets are already decrypted by ConfigService)
            logger.debug(
              `[auth-backend]    -> Config keys for ${
                strategy.id
              }: ${Object.keys(strategyConfig || {}).join(", ")}`,
            );

            const providerFactory = (
              socialProviderFactories as Record<string, unknown>
            )[strategy.id];

            if (typeof providerFactory === "function") {
              socialProviders[strategy.id] = (
                providerFactory as (options: unknown) => unknown
              )(strategyConfig);
              logger.debug(
                `[auth-backend]    -> ✅ Added ${strategy.id} to socialProviders`,
              );
            } else {
              logger.debug(
                `[auth-backend]    -> Strategy ${strategy.id} is not a standard social provider, skipping better-auth registration`,
              );
            }
          }

          // Check if credential strategy is enabled from meta config
          const credentialStrategy = strategies.find(
            (s) => s.id === "credential",
          );
          const credentialMetaConfig = credentialStrategy
            ? await config.get(
                "credential.meta",
                strategyMetaConfigV1,
                STRATEGY_META_CONFIG_VERSION,
              )
            : undefined;
          // Default to true on fresh installs (no meta config)
          const credentialEnabled = credentialMetaConfig?.enabled ?? true;

          const baseUrl = process.env.BASE_URL;
          if (!baseUrl) {
            throw new Error(
              "[auth-backend] BASE_URL environment variable is not defined.",
            );
          }

          const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
          if (!betterAuthSecret) {
            throw new Error(
              "[auth-backend] BETTER_AUTH_SECRET environment variable is not defined.",
            );
          }

          const checkstackBridge = {
            id: "checkstack-bridge",
            endpoints: {
              trustedLogin: createAuthEndpoint(
                "/internal/trusted-login",
                {
                  method: "POST",
                  body: z.object({ userId: z.string() }),
                },
                async (ctx) => {
                  const secretHeader = ctx.request?.headers.get(
                    "x-checkstack-internal",
                  );
                  if (
                    !secretHeader ||
                    secretHeader !== betterAuthSecret
                  ) {
                    throw new APIError("UNAUTHORIZED");
                  }

                  const { userId } = ctx.body;
                  const ipAddress =
                    ctx.request?.headers
                      .get("x-forwarded-for")
                      ?.split(",")[0]
                      .trim() || undefined;
                  const userAgent =
                    ctx.request?.headers.get("user-agent") || undefined;

                  const session =
                    await ctx.context.internalAdapter.createSession(
                      userId,
                      false,
                      {
                        ipAddress,
                        userAgent,
                      },
                    );
                  const user =
                    await ctx.context.internalAdapter.findUserById(userId);

                  if (!user) {
                    throw new APIError("NOT_FOUND", {
                      message: "User not found",
                    });
                  }

                  await setSessionCookie(ctx, { session, user });
                  return ctx.json({ success: true, sessionId: session.id });
                },
              ),
            },
          };

          // Check platform registration setting
          const platformRegistrationConfig = await config.get(
            PLATFORM_REGISTRATION_CONFIG_ID,
            platformRegistrationConfigV1,
            PLATFORM_REGISTRATION_CONFIG_VERSION,
          );
          const registrationAllowed =
            platformRegistrationConfig?.allowRegistration ?? true;

          // AI platform OAuth AS + MCP server settings (off by default).
          const mcpOAuthConfig = await config.get(
            MCP_OAUTH_CONFIG_ID,
            mcpOAuthConfigV1,
            MCP_OAUTH_CONFIG_VERSION,
          );
          const mcpEnabled = mcpOAuthConfig?.enabled ?? false;

          // The OAuth AS + MCP plugin. Enabled only when an operator opts in.
          //
          // The `mcp` plugin internally instantiates `oidcProvider` from its
          // `oidcConfig`, so we add ONLY `mcp` here (adding `oidcProvider`
          // separately would double-register its endpoints). oidcProvider
          // issues OPAQUE access tokens and owns the token / client / consent
          // tables (added to the Drizzle schema). The DCR endpoint
          // (`/mcp/register`) is gated by `allowDynamicClientRegistration`; the
          // per-IP DCR rate-limit is a separate shared-Postgres counter
          // enforced in the API route handler below.
          const aiOAuthPlugins = mcpEnabled
            ? [
                mcp({
                  loginPage: "/auth/login",
                  resource: `${baseUrl}/api/ai/mcp`,
                  oidcConfig: {
                    loginPage: "/auth/login",
                    consentPage: "/auth/oauth-consent",
                    allowDynamicClientRegistration:
                      mcpOAuthConfig?.allowDynamicClientRegistration ?? false,
                  },
                }),
              ]
            : [];

          logger.debug(
            `[auth-backend] Initializing Better Auth with ${
              Object.keys(socialProviders).length
            } social providers: ${Object.keys(socialProviders).join(", ")}`,
          );

          const authOptions: BetterAuthOptions = {
            database: drizzleAdapter(database, {
              provider: "pg",
              schema: { ...schema },
            }),
            // Brute-force limiter MUST be shared across pods. better-auth
            // defaults to per-pod in-memory storage, which would let N pods each
            // allow the cap = N x the intended limit (state-and-scale §14.5).
            // Back it with the shared `better_auth_rate_limit` table instead.
            // `enabled` is left at better-auth's default (on in production, off
            // in dev) so local development is unaffected.
            rateLimit: {
              customStorage: createBetterAuthRateLimitStore({ db: database }),
            },
            session: {
              cookieCache: {
                enabled: true,
                maxAge: 5 * 60, // 5 minutes — session verified from signed cookie, not DB
              },
            },
            emailAndPassword: {
              enabled: credentialEnabled,
              autoSignIn: true, // Log in user immediately after successful registration
              disableSignUp: !registrationAllowed,
              minPasswordLength: 8,
              maxPasswordLength: 128,
              sendResetPassword: async ({ user, token }) => {
                // Send password reset notification via all enabled strategies
                // Using void to prevent timing attacks revealing email existence
                const notificationClient = rpcClient.forPlugin(NotificationApi);
                const resetUrl = `${baseUrl}/auth/reset-password?token=${encodeURIComponent(
                  token,
                )}`;

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
                  `[auth-backend] Password reset email sent to user: ${user.id}`,
                );
              },
              resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
            },
            socialProviders,
            basePath: "/api/auth",
            baseURL: baseUrl,
            trustedOrigins: [baseUrl],
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
                    // Auto-assign "users" role to new users (via the store; a
                    // just-created user cannot be cached yet, so no invalidation).
                    try {
                      await new RoleMembershipStore(
                        database,
                        resolvedAuthCache,
                      ).grantInitialRoles({
                        runner: database,
                        userId: user.id,
                        roleIds: [USERS_ROLE_ID],
                      });
                      logger.debug(
                        `[auth-backend] Assigned 'users' role to new user: ${user.id}`,
                      );
                    } catch (error) {
                      // Role might not exist yet on first boot, that's okay
                      logger.debug(
                        `[auth-backend] Could not assign 'users' role to ${user.id}: ${error}`,
                      );
                    }
                  },
                },
              },
            },
            plugins: [checkstackBridge, ...aiOAuthPlugins],
          };

          return betterAuth(authOptions);
        };

        // Initialize better-auth
        auth = await initializeBetterAuth();

        // Reload function for dynamic auth config changes
        const reloadAuth = async () => {
          logger.info(
            "[auth-backend] Reloading authentication configuration...",
          );
          auth = await initializeBetterAuth();
          logger.info("[auth-backend] ✅ Authentication reloaded successfully");
        };

        // IMPORTANT: Seed roles BEFORE syncing access rules so default perms can
        // be assigned. Boot-time seeding lives in access-rule-sync.ts (the one
        // sanctioned non-store writer of the role tables); see its header.
        await seedSystemRoles({ database, logger });

        // Note: Access rule sync happens in afterPluginsReady (when all plugins have registered)

        // 4. Register oRPC router
        const authRouter = createAuthRouter(
          database as SafeDatabase<typeof schema>,
          strategyRegistry,
          reloadAuth,
          config,
          accessRuleRegistry,
          () => auth,
          logger,
          resourceResolverRegistry,
          resolvedAuthCache,
        );
        rpc.registerRouter(authRouter, authContract);

        // 5. Register Better Auth native handler.
        //
        // The Dynamic Client Registration endpoint (`/api/auth/mcp/register`)
        // is throttled per client IP by a SHARED-POSTGRES fixed-window counter
        // (state-and-scale §14.5 — never in-memory, so the cap holds across all
        // pods) BEFORE delegating to better-auth. Every other auth route passes
        // straight through.
        rpc.registerHttpHandler(async (req: Request) => {
          const url = new URL(req.url);
          if (
            req.method === "POST" &&
            url.pathname.endsWith("/mcp/register")
          ) {
            const cfg = await config.get(
              MCP_OAUTH_CONFIG_ID,
              mcpOAuthConfigV1,
              MCP_OAUTH_CONFIG_VERSION,
            );
            const ip = clientIpOf(req);
            const result = await checkRateLimit({
              db: database as SafeDatabase<typeof schema>,
              key: `dcr:${ip}`,
              max: cfg?.dcrRateLimitMax ?? 5,
              windowSeconds: cfg?.dcrRateLimitWindowSeconds ?? 3600,
            });
            if (!result.allowed) {
              return Response.json(
                {
                  error: "rate_limit_exceeded",
                  error_description:
                    "Too many client registrations from this IP. Try again later.",
                },
                { status: 429 },
              );
            }
          }
          return auth!.handler(req);
        });

        // All auth management endpoints are now via oRPC (see ./router.ts)
        // Note: Admin user seeding removed - handled via onboarding flow

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

        // Periodically prune expired better-auth rate-limit rows so the shared
        // `better_auth_rate_limit` table does not grow unbounded (the limiter's
        // upsert never deletes). Uses the platform's recurring-queue mechanism;
        // the work-queue consumer group means exactly one pod runs each fire,
        // and the DELETE is idempotent regardless.
        const pruneQueue = queueManager.getQueue<Record<string, never>>(
          RATE_LIMIT_PRUNE_QUEUE,
        );
        await pruneQueue.consume(
          async () => {
            const { deletedCount } = await pruneExpiredBetterAuthRateLimits({
              db: database as SafeDatabase<typeof schema>,
            });
            if (deletedCount > 0) {
              logger.debug(
                `[auth-backend] Pruned ${deletedCount} expired rate-limit row(s).`,
              );
            }
          },
          {
            consumerGroup: RATE_LIMIT_PRUNE_WORKER_GROUP,
            maxRetries: 0, // Idempotent sweep; next tick retries anyway.
          },
        );
        await pruneQueue.scheduleRecurring(
          {},
          {
            jobId: RATE_LIMIT_PRUNE_JOB_ID,
            cronPattern: RATE_LIMIT_PRUNE_CRON,
          },
        );

        logger.debug("✅ Auth Backend initialized.");
      },
      // Phase 3: After all plugins are ready - sync all access rules including defaults
      afterPluginsReady: async ({ database, logger, onHook }) => {
        // `init` (which sets `authCache`) always runs before this phase; assert
        // it so the deregister-cleanup store below has a real cache to invalidate.
        const resolvedAuthCache = authCache;
        if (!resolvedAuthCache) {
          throw new Error(
            "[auth-backend] authCache not initialized before afterPluginsReady",
          );
        }
        // Now that all plugins are ready, sync access rules including defaults
        // This is critical because during init, other plugins haven't registered yet
        const allAccessRules = accessRuleRegistry.getAccessRules();
        logger.debug(
          `[auth-backend] afterPluginsReady: syncing ${allAccessRules.length} access rules from all plugins`,
        );
        await syncAccessRulesToDb({
          database: database as SafeDatabase<typeof schema>,
          logger,
          accessRules: allAccessRules,
          fullSync: true,
          // Shared cache: a later pod's boot / a redeploy runs this against a
          // warm cluster cache, so evict when a default-rule change actually
          // mutates a non-admin role's grants (idempotent no-change = no evict).
          authCache: resolvedAuthCache,
        });

        // Subscribe to access rule registration hook for future registrations
        // This syncs new access rules when other plugins register them dynamically
        onHook(
          coreHooks.accessRulesRegistered,
          async ({ accessRules }) => {
            await syncAccessRulesToDb({
              database: database as SafeDatabase<typeof schema>,
              logger,
              accessRules,
            });
          },
          {
            mode: "work-queue",
            workerGroup: "access-rule-db-sync",
            maxRetries: 5,
          },
        );

        // Subscribe to plugin deregistered hook for access rule cleanup
        // When a plugin is removed at runtime, delete its access rules from DB
        onHook(
          coreHooks.pluginDeregistered,
          async ({ pluginId }) => {
            logger.debug(
              `[auth-backend] Cleaning up access rules for deregistered plugin: ${pluginId}`,
            );

            // Delete all access rules with this plugin's prefix
            const allDbAccessRules = await database
              .select()
              .from(schema.accessRule);
            const pluginAccessRules = allDbAccessRules.filter((p) =>
              p.id.startsWith(`${pluginId}.`),
            );

            // Remove the role -> access-rule mappings via the store, which busts
            // the role -> rules cache on the shared backend; then delete the
            // access rules themselves (the `access_rule` table is not cached).
            const accessRuleIds = pluginAccessRules.map((p) => p.id);
            await new RoleMembershipStore(
              database,
              resolvedAuthCache,
            ).removeAccessRuleMappings({ accessRuleIds });
            for (const perm of pluginAccessRules) {
              await database
                .delete(schema.accessRule)
                .where(eq(schema.accessRule.id, perm.id));
              logger.debug(`   -> Removed access rule: ${perm.id}`);
            }

            logger.debug(
              `[auth-backend] Cleaned up ${pluginAccessRules.length} access rules for ${pluginId}`,
            );
          },
          {
            mode: "work-queue",
            workerGroup: "access-rule-cleanup",
            maxRetries: 3,
          },
        );

        // No cross-pod broadcast for the auth read-path caches: they run on the
        // platform CacheManager, so a mutation's `invalidate` (a `delete` on the
        // shared backend) is visible to every pod immediately with a distributed
        // provider. The prior per-pod caches + broadcast hooks were removed.

        logger.debug("✅ Auth Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export utility functions for use by custom auth strategies
export * from "./utils/auth-error-redirect";

// Re-export hooks for cross-plugin communication
export { authHooks } from "./hooks";

// AI platform OAuth AS surface: scope narrowing, the introspect-time branch,
// and the shared-Postgres rate limiter (reused/tested by ai-backend + docs).
export {
  narrowScopes,
  expandBundles,
  SCOPE_BUNDLE,
  type ScopeBundle,
} from "./scope-narrowing";
export {
  narrowedPrincipalFromSession,
  introspectOpaqueToken,
  opaqueBearerToken,
  type IntrospectedOAuthSession,
  type LivePrincipal,
} from "./oauth-branch";
export {
  checkRateLimit,
  windowStartFor,
  type RateLimitResult,
} from "./rate-limit";
export {
  mcpOAuthConfigV1,
  MCP_OAUTH_CONFIG_ID,
  MCP_OAUTH_CONFIG_VERSION,
  type McpOAuthConfig,
} from "./mcp-oauth-config";
