import {
  createBackendPlugin,
  coreServices,
  createExtensionPoint,
  coreHooks,
  type NotificationStrategy,
  type RegisteredNotificationStrategy,
  type NotificationStrategyRegistry,
} from "@checkmate/backend-api";
import { permissionList, pluginMetadata } from "@checkmate/notification-common";
import type { PluginMetadata } from "@checkmate/common";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { createNotificationRouter } from "./router";
import { authHooks } from "@checkmate/auth-backend";
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
  addStrategy(
    strategy: NotificationStrategy<unknown, unknown, unknown>,
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
  getNewPermissions: () => Array<{
    id: string;
    description: string;
    ownerPluginId: string;
  }>;
} {
  const strategies = new Map<
    string,
    RegisteredNotificationStrategy<unknown, unknown, unknown>
  >();
  const newPermissions: Array<{
    id: string;
    description: string;
    ownerPluginId: string;
  }> = [];

  return {
    register(
      strategy: NotificationStrategy<unknown, unknown, unknown>,
      metadata: PluginMetadata
    ): void {
      const qualifiedId = `${metadata.pluginId}.${strategy.id}`;
      const permissionId = `${metadata.pluginId}.strategy.${strategy.id}.use`;

      const registered: RegisteredNotificationStrategy<
        unknown,
        unknown,
        unknown
      > = {
        ...strategy,
        qualifiedId,
        ownerPluginId: metadata.pluginId,
        permissionId,
      };

      strategies.set(qualifiedId, registered);

      // Track new permission for later registration
      newPermissions.push({
        id: permissionId,
        description: `Use ${strategy.displayName} notification channel`,
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
      userPermissions: Set<string>
    ): RegisteredNotificationStrategy<unknown, unknown, unknown>[] {
      return [...strategies.values()].filter((s) =>
        userPermissions.has(s.permissionId)
      );
    },

    getNewPermissions() {
      return newPermissions;
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

    // Register static permissions
    env.registerPermissions(permissionList);

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
        config: coreServices.config,
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, config, signalService }) => {
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
          strategyRegistry
        );
        rpc.registerRouter(router);

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

        // Emit dynamic permissions for strategies
        const newPermissions = strategyRegistry.getNewPermissions();
        if (newPermissions.length > 0) {
          logger.debug(
            `🔐 Registering ${newPermissions.length} dynamic strategy permissions`
          );

          // Group permissions by owner plugin and emit hooks
          const byPlugin = new Map<
            string,
            Array<{ id: string; description: string }>
          >();
          for (const perm of newPermissions) {
            const existing = byPlugin.get(perm.ownerPluginId) ?? [];
            existing.push({ id: perm.id, description: perm.description });
            byPlugin.set(perm.ownerPluginId, existing);
          }

          // Emit permissions registered hook for each plugin's permissions
          for (const [ownerPluginId, permissions] of byPlugin) {
            await emitHook(coreHooks.permissionsRegistered, {
              pluginId: ownerPluginId,
              permissions: permissions.map((p) => ({
                id: p.id,
                description: p.description,
              })),
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
