import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
  type RealUser,
  type ConfigService,
  toJsonSchema,
  type NotificationStrategyRegistry,
  type RpcClient,
  type NotificationPayload,
  type NotificationSendContext,
  Logger,
} from "@checkmate/backend-api";
import {
  notificationContract,
  NOTIFICATION_RECEIVED,
  NOTIFICATION_READ,
} from "@checkmate/notification-common";
import { AuthApi } from "@checkmate/auth-common";
import type { SignalService } from "@checkmate/signal-common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  deleteNotification,
  getAllGroups,
  getEnrichedUserSubscriptions,
  subscribeToGroup,
  unsubscribeFromGroup,
} from "./service";
import {
  retentionConfigV1,
  RETENTION_CONFIG_VERSION,
  RETENTION_CONFIG_ID,
} from "./retention-config";
import {
  createStrategyService,
  type StrategyService,
} from "./strategy-service";

/**
 * Creates the notification router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
 */
export const createNotificationRouter = (
  database: NodePgDatabase<typeof schema>,
  configService: ConfigService,
  signalService: SignalService,
  strategyRegistry: NotificationStrategyRegistry,
  rpcApi: RpcClient,
  logger: Logger
) => {
  // Create strategy service for config management
  const strategyService: StrategyService = createStrategyService({
    db: database,
    configService,
    strategyRegistry,
  });

  /**
   * Helper: Send notification to all enabled external channels for a user.
   * Silently skips channels that aren't configured or fail.
   */
  const sendToExternalChannels = async (
    userId: string,
    notification: {
      title: string;
      body?: string;
      importance: string;
      action?: { label: string; url: string };
    }
  ): Promise<void> => {
    const authClient = rpcApi.forPlugin(AuthApi);

    // Get user info
    const user = await authClient.getUserById({ userId });
    if (!user) return;

    // Get all enabled strategies
    const strategies = strategyRegistry.getStrategies();

    for (const strategy of strategies) {
      try {
        logger.debug(
          `[external-delivery] Checking strategy ${strategy.qualifiedId}...`
        );

        const meta = await strategyService.getStrategyMeta(
          strategy.qualifiedId
        );
        if (!meta.enabled) {
          logger.debug(
            `[external-delivery] Strategy ${strategy.qualifiedId} is disabled, skipping`
          );
          continue;
        }

        // Check user preference - skip if user disabled this channel
        const pref = await strategyService.getUserPreference(
          userId,
          strategy.qualifiedId
        );
        logger.debug(
          `[external-delivery] User pref for ${strategy.qualifiedId}:`,
          pref
        );
        if (pref && pref.enabled === false) {
          logger.debug(
            `[external-delivery] User disabled ${strategy.qualifiedId}, skipping`
          );
          continue;
        }

        // Resolve contact based on contactResolution type
        let contact: string | undefined;
        const resType = strategy.contactResolution.type;

        switch (resType) {
          case "auth-email":
          case "auth-provider": {
            contact = user.email;
            break;
          }
          case "oauth-link": {
            if (pref?.externalId) contact = pref.externalId;
            break;
          }
          case "user-config": {
            const fieldName =
              "field" in strategy.contactResolution
                ? strategy.contactResolution.field
                : undefined;
            if (pref?.userConfig && fieldName) {
              contact = String(
                (pref.userConfig as Record<string, unknown>)[fieldName]
              );
            }
            break;
          }
        }

        logger.debug(
          `[external-delivery] Resolved contact for ${strategy.qualifiedId}: ${contact}`
        );
        if (!contact) {
          logger.debug(
            `[external-delivery] No contact for ${strategy.qualifiedId}, skipping`
          );
          continue;
        }

        // Get strategy config
        const strategyConfig = await strategyService.getStrategyConfig(
          strategy.qualifiedId
        );
        if (!strategyConfig) {
          logger.debug(
            `[external-delivery] No strategyConfig for ${strategy.qualifiedId}, skipping`
          );
          continue;
        }

        // Get optional configs
        const layoutConfig = await strategyService.getLayoutConfig(
          strategy.qualifiedId
        );

        const baseUrl = process.env.VITE_FRONTEND_URL;
        if (!baseUrl) {
          logger.error(
            "[notification-backend] No frontend URL configured, but action included only a path"
          );
          continue;
        }

        const actionUrl = notification.action?.url;
        if (actionUrl && !actionUrl.startsWith("http")) {
          notification.action!.url = `${baseUrl.replace(/\/$/, "")}${
            actionUrl.startsWith("/") ? "" : "/"
          }${actionUrl}`;
        }

        // Build payload
        const payload: NotificationPayload = {
          title: notification.title,
          body: notification.body,
          importance: notification.importance as
            | "info"
            | "warning"
            | "critical",
          action: notification.action,
          type: "notification",
        };

        // Build send context
        const sendContext: NotificationSendContext<unknown, unknown, unknown> =
          {
            user: {
              userId: user.id,
              email: user.email,
              displayName: user.name ?? undefined,
            },
            contact,
            notification: payload,
            strategyConfig,
            userConfig: pref?.userConfig,
            layoutConfig,
          };

        // Send (fire-and-forget, don't block on errors)
        logger.debug(
          `[external-delivery] Sending to ${strategy.qualifiedId} with contact ${contact}`
        );
        const result = await strategy.send(sendContext);
        logger.debug(
          `[external-delivery] Send result for ${strategy.qualifiedId}:`,
          result
        );
      } catch (error) {
        // Log error but continue - external delivery shouldn't block in-app
        logger.error(
          `[external-delivery] Error sending via ${strategy.qualifiedId}:`,
          error
        );
      }
    }
  };

  // Create contract implementer with context type AND auto auth middleware
  const os = implement(notificationContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    // ==========================================================================
    // USER NOTIFICATION ENDPOINTS
    // Contract meta: userType: "user", permissions: [notificationRead]
    // ==========================================================================

    getNotifications: os.getNotifications.handler(
      async ({ input, context }) => {
        // context.user is guaranteed to be RealUser by contract meta + autoAuthMiddleware
        const userId = (context.user as RealUser).id;

        const result = await getUserNotifications(database, userId, {
          limit: input.limit,
          offset: input.offset,
          unreadOnly: input.unreadOnly,
        });

        return {
          notifications: result.notifications.map((n) => ({
            id: n.id,
            userId: n.userId,
            title: n.title,
            body: n.body,
            action: n.action ?? undefined,
            importance: n.importance as "info" | "warning" | "critical",
            isRead: n.isRead,
            groupId: n.groupId ?? undefined,
            createdAt: n.createdAt,
          })),
          total: result.total,
        };
      }
    ),

    getUnreadCount: os.getUnreadCount.handler(async ({ context }) => {
      const userId = (context.user as RealUser).id;
      const count = await getUnreadCount(database, userId);
      return { count };
    }),

    markAsRead: os.markAsRead.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      await markAsRead(database, userId, input.notificationId);

      // Send signal to update NotificationBell in realtime
      void signalService.sendToUser(NOTIFICATION_READ, userId, {
        notificationId: input.notificationId,
      });
    }),

    deleteNotification: os.deleteNotification.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        await deleteNotification(database, userId, input.notificationId);
      }
    ),

    // ==========================================================================
    // GROUP & SUBSCRIPTION ENDPOINTS
    // ==========================================================================

    getGroups: os.getGroups.handler(async () => {
      // userType: "both" - accessible by users and services
      const groups = await getAllGroups(database);
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        ownerPlugin: g.ownerPlugin,
        createdAt: g.createdAt,
      }));
    }),

    getSubscriptions: os.getSubscriptions.handler(async ({ context }) => {
      const userId = (context.user as RealUser).id;
      const subscriptions = await getEnrichedUserSubscriptions(
        database,
        userId
      );
      return subscriptions;
    }),

    subscribe: os.subscribe.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      try {
        await subscribeToGroup(database, userId, input.groupId);
      } catch (error) {
        // Convert group-not-found errors to proper ORPC errors
        if (
          error instanceof Error &&
          error.message.includes("does not exist")
        ) {
          throw new ORPCError("NOT_FOUND", {
            message: `Notification group '${input.groupId}' does not exist. It may not have been created yet.`,
          });
        }
        throw error;
      }
    }),

    unsubscribe: os.unsubscribe.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      await unsubscribeFromGroup(database, userId, input.groupId);
    }),

    // ==========================================================================
    // ADMIN SETTINGS ENDPOINTS
    // Contract meta: userType: "user", permissions: [notificationAdmin]
    // ==========================================================================

    getRetentionSchema: os.getRetentionSchema.handler(() => {
      return toJsonSchema(retentionConfigV1);
    }),

    getRetentionSettings: os.getRetentionSettings.handler(async () => {
      const config = await configService.get(
        RETENTION_CONFIG_ID,
        retentionConfigV1,
        RETENTION_CONFIG_VERSION
      );
      return config ?? { enabled: false, retentionDays: 30 };
    }),

    setRetentionSettings: os.setRetentionSettings.handler(async ({ input }) => {
      await configService.set(
        RETENTION_CONFIG_ID,
        retentionConfigV1,
        RETENTION_CONFIG_VERSION,
        input
      );
    }),

    // ==========================================================================
    // BACKEND-TO-BACKEND GROUP MANAGEMENT
    // Contract meta: userType: "service"
    // ==========================================================================

    createGroup: os.createGroup.handler(async ({ input }) => {
      // Service-only - no user context needed
      const namespacedId = `${input.ownerPlugin}.${input.groupId}`;

      await database
        .insert(schema.notificationGroups)
        .values({
          id: namespacedId,
          name: input.name,
          description: input.description,
          ownerPlugin: input.ownerPlugin,
        })
        .onConflictDoUpdate({
          target: [schema.notificationGroups.id],
          set: {
            name: input.name,
            description: input.description,
          },
        });

      return { id: namespacedId };
    }),

    deleteGroup: os.deleteGroup.handler(async ({ input }) => {
      const { eq, and } = await import("drizzle-orm");

      const result = await database
        .delete(schema.notificationGroups)
        .where(
          and(
            eq(schema.notificationGroups.id, input.groupId),
            eq(schema.notificationGroups.ownerPlugin, input.ownerPlugin)
          )
        );

      return { success: (result.rowCount ?? 0) > 0 };
    }),

    getGroupSubscribers: os.getGroupSubscribers.handler(async ({ input }) => {
      const { eq } = await import("drizzle-orm");

      const subscribers = await database
        .select({ userId: schema.notificationSubscriptions.userId })
        .from(schema.notificationSubscriptions)
        .where(eq(schema.notificationSubscriptions.groupId, input.groupId));

      return { userIds: subscribers.map((s) => s.userId) };
    }),

    notifyUsers: os.notifyUsers.handler(async ({ input }) => {
      const { userIds, title, body, importance, action } = input;

      if (userIds.length === 0) {
        return { notifiedCount: 0 };
      }

      const notificationValues = userIds.map((userId) => ({
        userId,
        title,
        body,
        action,
        importance: importance ?? "info",
      }));

      const inserted = await database
        .insert(schema.notifications)
        .values(notificationValues)
        .returning({
          id: schema.notifications.id,
          userId: schema.notifications.userId,
        });

      // Send realtime signals to each user
      for (const notification of inserted) {
        void signalService.sendToUser(
          NOTIFICATION_RECEIVED,
          notification.userId,
          {
            id: notification.id,
            title,
            body,
            importance: importance ?? "info",
          }
        );
      }

      // Also send to external channels (Telegram, SMTP, etc.) - fire and forget
      for (const userId of userIds) {
        void sendToExternalChannels(userId, {
          title,
          body,
          importance: importance ?? "info",
          action,
        });
      }

      return { notifiedCount: userIds.length };
    }),

    // Notify all subscribers of multiple groups with internal deduplication
    notifyGroups: os.notifyGroups.handler(async ({ input }) => {
      const { groupIds, title, body, importance, action } = input;
      const { inArray } = await import("drizzle-orm");

      if (groupIds.length === 0) {
        return { notifiedCount: 0 };
      }

      // Get all subscribers for all groups, deduplicated
      const subscribers = await database
        .selectDistinct({ userId: schema.notificationSubscriptions.userId })
        .from(schema.notificationSubscriptions)
        .where(inArray(schema.notificationSubscriptions.groupId, groupIds));

      if (subscribers.length === 0) {
        return { notifiedCount: 0 };
      }

      const notificationValues = subscribers.map((sub) => ({
        userId: sub.userId,
        title,
        body,
        action,
        importance: importance ?? "info",
      }));

      const inserted = await database
        .insert(schema.notifications)
        .values(notificationValues)
        .returning({
          id: schema.notifications.id,
          userId: schema.notifications.userId,
        });

      // Send realtime signals to each subscriber
      for (const notification of inserted) {
        void signalService.sendToUser(
          NOTIFICATION_RECEIVED,
          notification.userId,
          {
            id: notification.id,
            title,
            body,
            importance: importance ?? "info",
          }
        );
      }

      // Also send to external channels (Telegram, SMTP, etc.) - fire and forget
      for (const sub of subscribers) {
        void sendToExternalChannels(sub.userId, {
          title,
          body,
          importance: importance ?? "info",
          action,
        });
      }

      return { notifiedCount: subscribers.length };
    }),

    // Send transactional notification via ALL enabled strategies
    // No internal notification created - sent directly via external channels
    sendTransactional: os.sendTransactional.handler(async ({ input }) => {
      const { userId, notification } = input;

      // Get all strategies
      const allStrategies = strategyRegistry.getStrategies();

      // Get user info from auth backend
      const authClient = rpcApi.forPlugin(AuthApi);
      const user = await authClient.getUserById({ userId });

      if (!user) {
        return {
          deliveredCount: 0,
          results: [
            {
              strategyId: "none",
              success: false,
              error: "User not found",
            },
          ],
        };
      }

      // Build results for each strategy
      const results: Array<{
        strategyId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const strategy of allStrategies) {
        // Check if strategy is enabled
        const meta = await strategyService.getStrategyMeta(
          strategy.qualifiedId
        );
        if (!meta.enabled) {
          continue; // Skip disabled strategies
        }

        // Resolve contact based on contactResolution type
        let contact: string | undefined;
        const resType = strategy.contactResolution.type;

        switch (resType) {
          case "auth-email": {
            contact = user.email;
            break;
          }
          case "auth-provider": {
            // Use email - would need provider lookup for more specific handling
            contact = user.email;
            break;
          }
          case "oauth-link": {
            // Get user preference to find their linked external ID
            const pref = await strategyService.getUserPreference(
              userId,
              strategy.qualifiedId
            );
            if (pref?.externalId) {
              contact = pref.externalId;
            }
            break;
          }
          case "user-config": {
            // Get user config field
            const pref = await strategyService.getUserPreference(
              userId,
              strategy.qualifiedId
            );
            const fieldName =
              "field" in strategy.contactResolution
                ? strategy.contactResolution.field
                : undefined;
            if (pref?.userConfig && fieldName) {
              contact = String(
                (pref.userConfig as Record<string, unknown>)[fieldName]
              );
            }
            break;
          }
        }

        if (!contact) {
          // Cannot resolve contact for this strategy, skip
          results.push({
            strategyId: strategy.qualifiedId,
            success: false,
            error: "Could not resolve user contact for this channel",
          });
          continue;
        }

        // Get strategy config
        const strategyConfig = await strategyService.getStrategyConfig(
          strategy.qualifiedId
        );
        if (!strategyConfig) {
          results.push({
            strategyId: strategy.qualifiedId,
            success: false,
            error: "Strategy not configured",
          });
          continue;
        }

        // Get layout config if supported
        const layoutConfig = await strategyService.getLayoutConfig(
          strategy.qualifiedId
        );

        // Get user config if strategy supports it
        const userPref = await strategyService.getUserPreference(
          userId,
          strategy.qualifiedId
        );

        // Build notification payload
        const payload: NotificationPayload = {
          title: notification.title,
          body: notification.body,
          importance: "critical", // Transactional messages are always critical
          action: notification.action,
          type: "transactional",
        };

        // Build send context
        const sendContext: NotificationSendContext<unknown, unknown, unknown> =
          {
            user: {
              userId: user.id,
              email: user.email,
              displayName: user.name ?? undefined,
            },
            contact,
            notification: payload,
            strategyConfig,
            userConfig: userPref?.userConfig,
            layoutConfig,
          };

        // Send via strategy
        try {
          const result = await strategy.send(sendContext);
          results.push({
            strategyId: strategy.qualifiedId,
            success: result.success,
            error: result.error,
          });
        } catch (error) {
          results.push({
            strategyId: strategy.qualifiedId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const deliveredCount = results.filter((r) => r.success).length;

      return { deliveredCount, results };
    }),

    // ==========================================================================
    // DELIVERY STRATEGY ADMIN ENDPOINTS
    // ==========================================================================

    getDeliveryStrategies: os.getDeliveryStrategies.handler(async () => {
      const strategies = strategyRegistry.getStrategies();

      const result = await Promise.all(
        strategies.map(async (strategy) => {
          // Get meta-config (enabled state)
          const meta = await strategyService.getStrategyMeta(
            strategy.qualifiedId
          );

          // Get redacted config (secrets stripped for frontend)
          const config = await strategyService.getStrategyConfigRedacted(
            strategy.qualifiedId
          );

          // Get redacted layout config (if strategy supports it)
          const layoutConfig = await strategyService.getLayoutConfigRedacted(
            strategy.qualifiedId
          );

          // Determine if strategy requires user config or OAuth
          const requiresUserConfig = !!strategy.userConfig;
          const requiresOAuthLink =
            strategy.contactResolution.type === "oauth-link";

          // Build JSON schema for DynamicForm
          const configSchema = toJsonSchema(strategy.config.schema);
          const userConfigSchema = strategy.userConfig
            ? toJsonSchema(strategy.userConfig.schema)
            : undefined;
          const layoutConfigSchema = strategy.layoutConfig
            ? toJsonSchema(strategy.layoutConfig.schema)
            : undefined;

          return {
            qualifiedId: strategy.qualifiedId,
            displayName: strategy.displayName,
            description: strategy.description,
            icon: strategy.icon,
            ownerPluginId: strategy.ownerPluginId,
            contactResolution: strategy.contactResolution as {
              type:
                | "auth-email"
                | "auth-provider"
                | "user-config"
                | "oauth-link";
              provider?: string;
              field?: string;
            },
            requiresUserConfig,
            requiresOAuthLink,
            configSchema,
            userConfigSchema,
            layoutConfigSchema,
            enabled: meta.enabled,
            config: config as Record<string, unknown> | undefined,
            layoutConfig: layoutConfig as Record<string, unknown> | undefined,
            adminInstructions: strategy.adminInstructions,
          };
        })
      );

      return result;
    }),

    updateDeliveryStrategy: os.updateDeliveryStrategy.handler(
      async ({ input }) => {
        const { strategyId, enabled, config, layoutConfig } = input;

        const strategy = strategyRegistry.getStrategy(strategyId);
        if (!strategy) {
          throw new ORPCError("NOT_FOUND", {
            message: `Strategy not found: ${strategyId}`,
          });
        }

        // Update meta-config (enabled state)
        await strategyService.setStrategyMeta(strategyId, { enabled });

        // Update config if provided
        if (config !== undefined) {
          await strategyService.setStrategyConfig(strategyId, config);
        }

        // Update layout config if provided
        if (layoutConfig !== undefined && strategy.layoutConfig) {
          await strategyService.setLayoutConfig(strategyId, layoutConfig);
        }
      }
    ),

    // ==========================================================================
    // USER DELIVERY PREFERENCE ENDPOINTS
    // ==========================================================================

    getUserDeliveryChannels: os.getUserDeliveryChannels.handler(
      async ({ context }) => {
        const userId = (context.user as RealUser).id;
        const strategies = strategyRegistry.getStrategies();

        // Get user's preferences (redacted - no secrets)
        const userPrefs = await strategyService.getAllUserPreferencesRedacted(
          userId
        );
        const prefsMap = new Map(
          userPrefs.map((p) => [p.strategyId, p.preference])
        );

        // Get enabled strategies only
        const enabledStrategies = await Promise.all(
          strategies.map(async (strategy) => {
            const meta = await strategyService.getStrategyMeta(
              strategy.qualifiedId
            );
            return { strategy, enabled: meta.enabled };
          })
        );

        const result = enabledStrategies
          .filter((s) => s.enabled)
          .map(({ strategy }) => {
            const pref = prefsMap.get(strategy.qualifiedId);

            // Determine if channel is configured (ready to send)
            let isConfigured = false;
            const resType = strategy.contactResolution.type;

            switch (resType) {
              case "auth-email":
              case "auth-provider": {
                // These just need user's email - always configured
                isConfigured = true;
                break;
              }
              case "oauth-link": {
                // Need to be linked
                isConfigured = !!pref?.linkedAt;
                break;
              }
              case "user-config": {
                // Need user to provide config
                isConfigured = !!pref?.userConfig;
                break;
              }
            }

            // Build JSON schema for user config (if applicable)
            const userConfigSchema = strategy.userConfig
              ? toJsonSchema(strategy.userConfig.schema)
              : undefined;

            return {
              strategyId: strategy.qualifiedId,
              displayName: strategy.displayName,
              description: strategy.description,
              icon: strategy.icon,
              contactResolution: {
                type: resType,
              },
              enabled: pref?.enabled ?? true,
              isConfigured,
              linkedAt: pref?.linkedAt ? new Date(pref.linkedAt) : undefined,
              userConfigSchema,
              userConfig: pref?.userConfig,
              userInstructions: strategy.userInstructions,
            };
          });

        return result;
      }
    ),

    setUserDeliveryPreference: os.setUserDeliveryPreference.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        const { strategyId, enabled, userConfig } = input;

        const strategy = strategyRegistry.getStrategy(strategyId);
        if (!strategy) {
          throw new ORPCError("NOT_FOUND", {
            message: `Strategy not found: ${strategyId}`,
          });
        }

        await strategyService.setUserPreference(userId, strategyId, {
          enabled,
          userConfig: userConfig as Record<string, unknown> | undefined,
        });
      }
    ),

    getDeliveryOAuthUrl: os.getDeliveryOAuthUrl.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        const { strategyId, returnUrl } = input;

        const strategy = strategyRegistry.getStrategy(strategyId);
        if (!strategy) {
          throw new ORPCError("NOT_FOUND", {
            message: `Strategy not found: ${strategyId}`,
          });
        }

        if (!strategy.oauth) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Strategy ${strategyId} does not support OAuth`,
          });
        }

        // Build the OAuth authorization URL
        const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
        const callbackUrl = `${baseUrl}/api/notification/oauth/${strategyId}/callback`;
        const defaultReturnUrl = "/notification/settings";

        // Encode state for CSRF protection
        const stateData = JSON.stringify({
          userId,
          returnUrl: returnUrl ?? defaultReturnUrl,
          ts: Date.now(),
        });
        const state = btoa(stateData);

        // Resolve client ID (may be a function)
        const clientIdVal = strategy.oauth.clientId;
        const clientId =
          typeof clientIdVal === "function" ? await clientIdVal() : clientIdVal;

        // Build authorization URL
        const url = new URL(strategy.oauth.authorizationUrl);
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", callbackUrl);
        url.searchParams.set("scope", strategy.oauth.scopes.join(" "));
        url.searchParams.set("state", state);
        url.searchParams.set("response_type", "code");

        return { authUrl: url.toString() };
      }
    ),

    unlinkDeliveryChannel: os.unlinkDeliveryChannel.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        const { strategyId } = input;

        const strategy = strategyRegistry.getStrategy(strategyId);
        if (!strategy) {
          throw new ORPCError("NOT_FOUND", {
            message: `Strategy not found: ${strategyId}`,
          });
        }

        // Clear OAuth tokens
        await strategyService.clearOAuthTokens(userId, strategyId);
      }
    ),

    // Send a test notification to the current user via a specific strategy
    sendTestNotification: os.sendTestNotification.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        const { strategyId } = input;

        const strategy = strategyRegistry.getStrategy(strategyId);
        if (!strategy) {
          return { success: false, error: `Strategy not found: ${strategyId}` };
        }

        // Check strategy is enabled
        const meta = await strategyService.getStrategyMeta(strategyId);
        if (!meta.enabled) {
          return {
            success: false,
            error: "This channel is not enabled by your administrator",
          };
        }

        // Get user info
        const authClient = rpcApi.forPlugin(AuthApi);
        const user = await authClient.getUserById({ userId });
        if (!user) {
          return { success: false, error: "User not found" };
        }

        // Get user preference to resolve contact
        const pref = await strategyService.getUserPreference(
          userId,
          strategyId
        );
        let contact: string | undefined;

        const resType = strategy.contactResolution.type;
        switch (resType) {
          case "auth-email":
          case "auth-provider": {
            contact = user.email;
            break;
          }
          case "oauth-link": {
            if (pref?.externalId) contact = pref.externalId;
            break;
          }
          case "user-config": {
            const fieldName =
              "field" in strategy.contactResolution
                ? strategy.contactResolution.field
                : undefined;
            if (pref?.userConfig && fieldName) {
              contact = String(
                (pref.userConfig as Record<string, unknown>)[fieldName]
              );
            }
            break;
          }
        }

        if (!contact) {
          return {
            success: false,
            error:
              "Channel not configured - please set up your contact information first",
          };
        }

        // Get strategy config
        const strategyConfig = await strategyService.getStrategyConfig(
          strategyId
        );
        if (!strategyConfig) {
          return {
            success: false,
            error: "Channel not configured by administrator",
          };
        }

        const layoutConfig = await strategyService.getLayoutConfig(strategyId);

        // Build test notification with markdown and action
        const testNotification: NotificationPayload = {
          title: "🧪 Test Notification",
          body: `This is a **test notification** from Checkmate!\n\nIf you're seeing this, your *${strategy.displayName}* channel is working correctly.\n\n✅ Markdown formatting\n✅ Emoji support\n✅ Action buttons (below)`,
          importance: "info",
          action: {
            label: "Open Notification Settings",
            url: "/notification/settings",
          },
          type: "notification",
        };

        // Get base URL for action
        const baseUrl = process.env.VITE_FRONTEND_URL;
        if (baseUrl && testNotification.action) {
          testNotification.action.url = `${baseUrl.replace(/\/$/, "")}${
            testNotification.action.url
          }`;
        }

        // Build send context
        const sendContext: NotificationSendContext<unknown, unknown, unknown> =
          {
            user: {
              userId: user.id,
              email: user.email,
              displayName: user.name ?? undefined,
            },
            contact,
            notification: testNotification,
            strategyConfig,
            userConfig: pref?.userConfig,
            layoutConfig,
          };

        // Send via strategy
        try {
          const result = await strategy.send(sendContext);
          return { success: result.success, error: result.error };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to send test notification",
          };
        }
      }
    ),
  });
};

export type NotificationRouter = ReturnType<typeof createNotificationRouter>;
