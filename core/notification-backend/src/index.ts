import {
  createBackendPlugin,
  coreServices,
  createExtensionPoint,
  coreHooks,
  type NotificationStrategy,
  type RegisteredNotificationStrategy,
  type NotificationStrategyRegistry,
} from "@checkstack/backend-api";
import {
  notificationAccessRules,
  pluginMetadata,
  notificationContract,
} from "@checkstack/notification-common";
import {
  access,
  type PluginMetadata,
  type AccessRule,
} from "@checkstack/common";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { createNotificationRouter } from "./router";
import { authHooks } from "@checkstack/auth-backend";
import { createOAuthCallbackHandler } from "./oauth-callback-handler";
import { createStrategyService } from "./strategy-service";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Extension Point
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NotificationStrategyExtensionPoint {
  /**
   * Register a notification strategy.
   * The strategy will be namespaced by the plugin's ID automatically.
   */
  addStrategy<TConfig, TUserConfig, TLayoutConfig>(
    strategy: NotificationStrategy<TConfig, TUserConfig, TLayoutConfig>,
    pluginMetadata: PluginMetadata
  ): void;
}

export const notificationStrategyExtensionPoint =
  createExtensionPoint<NotificationStrategyExtensionPoint>(
    "notification.strategyExtensionPoint"
  );

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registry Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create a new notification strategy registry instance.
 */
function createNotificationStrategyRegistry(): NotificationStrategyRegistry & {
  getNewAccessRules: () => Array<{
    accessRule: AccessRule;
    ownerPluginId: string;
  }>;
} {
  const strategies = new Map<
    string,
    RegisteredNotificationStrategy<unknown, unknown, unknown>
  >();
  const newAccessRules: Array<{
    accessRule: AccessRule;
    ownerPluginId: string;
  }> = [];

  return {
    register<TConfig, TUserConfig, TLayoutConfig>(
      strategy: NotificationStrategy<TConfig, TUserConfig, TLayoutConfig>,
      metadata: PluginMetadata
    ): void {
      const qualifiedId = `${metadata.pluginId}.${strategy.id}`;
      const accessRuleId = `${metadata.pluginId}.strategy.${strategy.id}.use`;

      // Cast to unknown for storage - registry stores heterogeneous strategies
      const registered: RegisteredNotificationStrategy<
        unknown,
        unknown,
        unknown
      > = {
        ...(strategy as NotificationStrategy<unknown, unknown, unknown>),
        qualifiedId,
        ownerPluginId: metadata.pluginId,
        accessRuleId,
      };

      strategies.set(qualifiedId, registered);

      // Track new access rule for later registration
      newAccessRules.push({
        accessRule: access(
          `strategy.${strategy.id}`,
          "manage",
          `Use ${strategy.displayName} notification channel`
        ),
        ownerPluginId: metadata.pluginId,
      });
    },

    getStrategy(
      qualifiedId: string
    ): RegisteredNotificationStrategy<unknown, unknown, unknown> | undefined {
      return strategies.get(qualifiedId);
    },

    getStrategies(): RegisteredNotificationStrategy<
      unknown,
      unknown,
      unknown
    >[] {
      return [...strategies.values()];
    },

    getStrategiesForUser(
      userAccessRules: Set<string>
    ): RegisteredNotificationStrategy<unknown, unknown, unknown>[] {
      return [...strategies.values()].filter((s) =>
        userAccessRules.has(s.accessRuleId)
      );
    },

    getNewAccessRules() {
      return newAccessRules;
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Create the strategy registry
    const strategyRegistry = createNotificationStrategyRegistry();

    // Register static access rules
    env.registerAccessRules(notificationAccessRules);

    // Register the extension point
    env.registerExtensionPoint(notificationStrategyExtensionPoint, {
      addStrategy: (strategy, metadata) => {
        strategyRegistry.register(strategy, metadata);
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        config: coreServices.config,
        signalService: coreServices.signalService,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        config,
        signalService,
      }) => {
        logger.debug("🔔 Initializing Notification Backend...");

        const db = database;
        const baseUrl =
          process.env.VITE_API_BASE_URL ?? "http://localhost:3000";

        // Create strategy service for config management (shared with afterPluginsReady)
        const strategyService = createStrategyService({
          db,
          configService: config,
          strategyRegistry,
        });

        // Store for afterPluginsReady access
        (
          env as unknown as { strategyService: typeof strategyService }
        ).strategyService = strategyService;

        // Create and register the notification router with strategy registry
        const router = createNotificationRouter(
          db,
          config,
          signalService,
          strategyRegistry,
          rpcClient,
          logger
        );
        rpc.registerRouter(router, notificationContract);

        // Register OAuth callback handler for strategy OAuth flows
        const oauthHandler = createOAuthCallbackHandler({
          db,
          configService: config,
          strategyRegistry,
          baseUrl,
        });
        rpc.registerHttpHandler(oauthHandler, "/oauth");

        logger.debug("✅ Notification Backend initialized.");
      },
      afterPluginsReady: async ({ database, logger, onHook, emitHook }) => {
        const db = database;

        // Log registered strategies
        const strategies = strategyRegistry.getStrategies();
        logger.debug(
          `📧 Registered ${
            strategies.length
          } notification strategies: ${strategies
            .map((s) => s.qualifiedId)
            .join(", ")}`
        );

        // Emit dynamic access rules for strategies
        const newAccessRules = strategyRegistry.getNewAccessRules();
        if (newAccessRules.length > 0) {
          logger.debug(
            `🔐 Registering ${newAccessRules.length} dynamic strategy access rules`
          );

          // Group access rules by owner plugin and emit hooks
          const byPlugin = new Map<string, AccessRule[]>();
          for (const item of newAccessRules) {
            const existing = byPlugin.get(item.ownerPluginId) ?? [];
            existing.push(item.accessRule);
            byPlugin.set(item.ownerPluginId, existing);
          }

          // Emit access rules registered hook for each plugin's rules
          for (const [ownerPluginId, accessRules] of byPlugin) {
            await emitHook(coreHooks.accessRulesRegistered, {
              pluginId: ownerPluginId,
              accessRules,
            });
          }
        }

        // Subscribe to user deletion to clean up notifications and subscriptions
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(
              `Cleaning up notifications for deleted user: ${userId}`
            );
            // Delete user notification preferences via ConfigService
            const strategyService = (
              env as unknown as {
                strategyService: ReturnType<typeof createStrategyService>;
              }
            ).strategyService;
            if (strategyService) {
              await strategyService.deleteUserPreferences(userId);
            }
            // Delete subscriptions (has userId reference)
            await db
              .delete(schema.notificationSubscriptions)
              .where(eq(schema.notificationSubscriptions.userId, userId));
            // Delete notifications for this user
            await db
              .delete(schema.notifications)
              .where(eq(schema.notifications.userId, userId));
            logger.debug(`Cleaned up notifications for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" }
        );

        logger.debug("✅ Notification Backend afterPluginsReady complete.");
      },
    });
  },
});
