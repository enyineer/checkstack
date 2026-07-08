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
  notificationRoutes,
  pluginMetadata,
  notificationContract,
} from "@checkstack/notification-common";
import {
  access,
  resolveRoute,
  type PluginMetadata,
  type AccessRule,
} from "@checkstack/common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { createNotificationRouter } from "./router";
import {
  createNotificationAudienceRegistry,
  notificationAudienceExtensionPoint,
} from "./audience";
import { createNotificationCache } from "./cache";
import { authHooks } from "@checkstack/auth-backend";
import { createOAuthCallbackHandler } from "./oauth-callback-handler";
import { createStrategyService, type StrategyService } from "./strategy-service";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
} from "@checkstack/automation-backend";
import {
  notificationActions,
  notificationSendArtifactType,
  notificationTriggers,
} from "./automations";
import { notificationHooks } from "./hooks";
import type { DispatchAttemptHookSink } from "./delivery-attempts";

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
// Shared render helpers for notification strategies
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export { SUBJECT_STATUS_EMOJI, IMPORTANCE_EMOJI } from "./render";
// Shared subject-render helpers (single-sourced in notification-common).
// Re-exported here so strategy plugins import them alongside
// `SUBJECT_STATUS_EMOJI` from `@checkstack/notification-backend` without
// taking a direct dependency on notification-common.
export {
  renderSubjectsAsPlainText,
  renderSubjectsAsMarkdown,
  renderSubjectsAsHtml,
  renderSubjectLabel,
  type SubjectLinkStyle,
} from "@checkstack/notification-common";
export { postJson } from "./post-json";
export type { PostJsonOptions, PostJsonResult } from "./post-json";
export { validateWebhookUrl, WEBHOOK_EGRESS_DENY_CIDRS } from "./egress";
export type { WebhookUrlValidation } from "./egress";

// External-audience fan-out (status-page email subscribers, ...).
export { notificationAudienceExtensionPoint } from "./audience";
export type {
  NotificationAudienceEvent,
  NotificationAudienceSink,
  NotificationAudienceExtensionPoint,
} from "./audience";

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
          `Use ${strategy.displayName} notification channel`,
          { pluginId: metadata.pluginId }
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

// Set in `init`, read by `afterPluginsReady`'s user-cleanup hook. Module-scoped
// holder bridges init() -> afterPluginsReady() (mirrors healthcheck-backend's
// `storedEmitHook`). Pod-local service handle, not queryable current state.
let storedStrategyService: StrategyService | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Create the strategy registry
    const strategyRegistry = createNotificationStrategyRegistry();

    // External-audience sink registry (e.g. status-page email subscribers). A
    // plugin contributes a sink via `notificationAudienceExtensionPoint`; the
    // dispatch path invokes them once per `notifyForSubscription`.
    const audienceRegistry = createNotificationAudienceRegistry();

    // Register static access rules
    env.registerAccessRules(notificationAccessRules);

    // Register the extension point
    env.registerExtensionPoint(notificationStrategyExtensionPoint, {
      addStrategy: (strategy, metadata) => {
        strategyRegistry.register(strategy, metadata);
      },
    });
    env.registerExtensionPoint(
      notificationAudienceExtensionPoint,
      audienceRegistry.extensionPoint,
    );

    // ─── Automation Platform: triggers + artifact type ─────────────────
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of notificationTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }
    env
      .getExtensionPoint(automationArtifactTypeExtensionPoint)
      .registerArtifactType(notificationSendArtifactType, pluginMetadata);

    // Late-bound hook sink. `afterPluginsReady` populates it once
    // `emitHook` is available; the router reads it lazily on every
    // dispatch, so until populated, delivery still works but no
    // automation triggers fire.
    const dispatchHookSinkRef: { current?: DispatchAttemptHookSink } = {};

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        config: coreServices.config,
        signalService: coreServices.signalService,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        config,
        signalService,
        cacheManager,
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
        storedStrategyService = strategyService;

        const cache = createNotificationCache({ cacheManager, logger });

        // Create and register the notification router with strategy registry
        const router = createNotificationRouter({
          database: db,
          configService: config,
          signalService,
          strategyRegistry,
          rpcApi: rpcClient,
          logger,
          cache,
          getDispatchHookSink: () => dispatchHookSinkRef.current,
          getAudienceSinks: () => audienceRegistry.list(),
        });
        rpc.registerRouter(router, notificationContract);

        // Register OAuth callback handler for strategy OAuth flows
        const oauthHandler = createOAuthCallbackHandler({
          db,
          configService: config,
          strategyRegistry,
          baseUrl,
          logger,
        });
        rpc.registerHttpHandler(oauthHandler, "/oauth");

        // Register the "Notification Settings" navigation command in the command
        // palette so the sidebar destination is reachable from Cmd+K. The nav
        // entry is gated only on being authenticated (no access rule), so the
        // command carries no `requiredAccessRules` to match.
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "settings",
              title: "Notification Settings",
              subtitle: "Manage notification channels and subscriptions",
              iconName: "Bell",
              route: resolveRoute(notificationRoutes.routes.settings),
            },
          ],
        });

        logger.debug("✅ Notification Backend initialized.");
      },
      afterPluginsReady: async ({
        database,
        logger,
        onHook,
        emitHook,
      }) => {
        const db = database;

        // Populate the late-bound dispatch hook sink. After this
        // point every external delivery attempt also fires the
        // matching automation trigger.
        dispatchHookSinkRef.current = {
          onDelivered: (event) =>
            emitHook(notificationHooks.delivered, event),
          onFailed: (event) =>
            emitHook(notificationHooks.failed, event),
        };

        // Register automation actions. The send action calls
        // `sendTransactional` through the run's `rpcClient` (the automation's
        // `runAs` service account), so no client is captured here.
        const automationActionsExt = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of notificationActions) {
          automationActionsExt.registerAction(action, pluginMetadata);
        }

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
            if (storedStrategyService) {
              await storedStrategyService.deleteUserPreferences(userId);
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
