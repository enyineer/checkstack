import { implement, ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
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
} from "@checkstack/backend-api";
import {
  notificationContract,
  NOTIFICATION_RECEIVED,
  NOTIFICATION_READ,
} from "@checkstack/notification-common";
import { AuthApi } from "@checkstack/auth-common";
import type { SignalService } from "@checkstack/signal-common";
import type { NotificationCache } from "./cache";
import { SafeDatabase } from "@checkstack/backend-api";
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
  deriveGroupId,
  provisionGroupsForResource,
  provisionGroupsForSpec,
  resolveInheritedGroupIds,
  teardownGroupsForResource,
} from "./subscription-engine";
import {
  retentionConfigV1,
  RETENTION_CONFIG_VERSION,
  RETENTION_CONFIG_ID,
} from "./retention-config";
import {
  createStrategyService,
  type StrategyService,
} from "./strategy-service";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Helper: Resolve user contact information based on strategy's contactResolution type.
 * Returns undefined if contact cannot be resolved.
 */
function resolveContact({
  strategy,
  userEmail,
  userPreference,
}: {
  strategy: { contactResolution: { type: string; field?: string } };
  userEmail?: string;
  userPreference?: {
    externalId?: string | null;
    userConfig?: Record<string, unknown> | null;
  } | null;
}): string | undefined {
  const resType = strategy.contactResolution.type;

  switch (resType) {
    case "auth-email":
    case "auth-provider": {
      return userEmail;
    }
    case "oauth-link": {
      return userPreference?.externalId ?? undefined;
    }
    case "user-config": {
      const fieldName =
        "field" in strategy.contactResolution
          ? strategy.contactResolution.field
          : undefined;
      if (userPreference?.userConfig && fieldName) {
        return String(userPreference.userConfig[fieldName]);
      }
      return undefined;
    }
    default: {
      throw new Error(`Unknown contact resolution type: ${resType}`);
    }
  }
}

/**
 * Substitute `{resourceKey}` in a stored legacy template to get the
 * actual legacy groupId to seed from.
 */
function makeLegacyResolver(template: string): (resourceKey: string) => string {
  return (resourceKey: string) =>
    template.replaceAll('{resourceKey}', resourceKey);
}

/**
 * Look up a target type and ensure the calling plugin owns it.
 * Centralizes the ownership check used by every target-mutating RPC.
 */
async function assertTargetOwnedBy(opts: {
  db: SafeDatabase<typeof schema>;
  targetTypeId: string;
  callerPluginId: string;
}): Promise<typeof schema.notificationTargets.$inferSelect> {
  const [target] = await opts.db
    .select()
    .from(schema.notificationTargets)
    .where(eq(schema.notificationTargets.targetTypeId, opts.targetTypeId))
    .limit(1);
  if (!target) {
    throw new ORPCError("NOT_FOUND", {
      message: `Notification target ${opts.targetTypeId} is not registered`,
    });
  }
  if (target.ownerPlugin !== opts.callerPluginId) {
    throw new ORPCError("FORBIDDEN", {
      message: `Plugin ${opts.callerPluginId} cannot mutate target ${opts.targetTypeId} (owned by ${target.ownerPlugin})`,
    });
  }
  return target;
}

/**
 * Creates the notification router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
export const createNotificationRouter = (
  database: SafeDatabase<typeof schema>,
  configService: ConfigService,
  signalService: SignalService,
  strategyRegistry: NotificationStrategyRegistry,
  rpcApi: RpcClient,
  logger: Logger,
  cache: NotificationCache,
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
      subjects?: NotificationPayload["subjects"];
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
        const contact = resolveContact({
          strategy,
          userEmail: user.email,
          userPreference: pref,
        });

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

        const baseUrl = process.env.BASE_URL;
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
          subjects: notification.subjects,
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
            logger,
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
    // Contract meta: userType: "user", accessRules: [notificationRead]
    // ==========================================================================

    getNotifications: os.getNotifications.handler(
      async ({ input, context }) => {
        // context.user is guaranteed to be RealUser by contract meta + autoAuthMiddleware
        const userId = (context.user as RealUser).id;

        return cache.wrapNotifications(userId, input, async () => {
          const result = await getUserNotifications(database, userId, {
            limit: input.limit,
            offset: input.offset,
            unreadOnly: input.unreadOnly,
          });

          return {
            items: result.notifications.map((n) => ({
              id: n.id,
              userId: n.userId,
              title: n.title,
              body: n.body,
              action: n.action ?? undefined,
              importance: n.importance as "info" | "warning" | "critical",
              isRead: n.isRead,
              collapseKey: n.collapseKey ?? undefined,
              subjects: n.subjects ?? undefined,
              createdAt: n.createdAt,
            })),
            total: result.total,
            limit: input.limit,
            offset: input.offset,
          };
        });
      }
    ),

    getUnreadCount: os.getUnreadCount.handler(async ({ context }) => {
      const userId = (context.user as RealUser).id;
      return cache.wrapUnread(userId, async () => {
        const count = await getUnreadCount(database, userId);
        return { count };
      });
    }),

    markAsRead: os.markAsRead.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      await markAsRead(database, userId, input.notificationId);

      // Mutation invariant: db.write → cache.invalidate (await) → signal.
      await cache.invalidateForUser(userId);

      // Send signal to update NotificationBell in realtime
      void signalService.sendToUser(NOTIFICATION_READ, userId, {
        notificationId: input.notificationId,
      });
    }),

    deleteNotification: os.deleteNotification.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        await deleteNotification(database, userId, input.notificationId);
        await cache.invalidateForUser(userId);
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
      return cache.wrapSubscriptions(userId, () =>
        getEnrichedUserSubscriptions(database, userId),
      );
    }),

    subscribe: os.subscribe.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      try {
        await subscribeToGroup(database, userId, input.groupId);
      } catch (error) {
        // Convert group-not-found errors to proper ORPC errors
        const message = extractErrorMessage(error);
        if (message.includes("does not exist")) {
          throw new ORPCError("NOT_FOUND", {
            message: `Notification group '${input.groupId}' does not exist. It may not have been created yet.`,
          });
        }
        throw error;
      }
      await cache.invalidateSubscriptions(userId);
    }),

    unsubscribe: os.unsubscribe.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      await unsubscribeFromGroup(database, userId, input.groupId);
      await cache.invalidateSubscriptions(userId);
    }),

    getMySubscriptionStatus: os.getMySubscriptionStatus.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        if (input.groupIds.length === 0) return {};

        const { eq, and, inArray } = await import("drizzle-orm");
        const rows = await database
          .select({ groupId: schema.notificationSubscriptions.groupId })
          .from(schema.notificationSubscriptions)
          .where(
            and(
              eq(schema.notificationSubscriptions.userId, userId),
              inArray(
                schema.notificationSubscriptions.groupId,
                input.groupIds,
              ),
            ),
          );

        const subscribed = new Set(rows.map((r) => r.groupId));
        return Object.fromEntries(
          input.groupIds.map((id) => [id, subscribed.has(id)]),
        );
      },
    ),

    // ==========================================================================
    // ADMIN SETTINGS ENDPOINTS
    // Contract meta: userType: "user", accessRules: [notificationAdmin]
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

    bulkSubscribe: os.bulkSubscribe.handler(async ({ input }) => {
      if (input.userIds.length === 0) {
        return { subscribedCount: 0 };
      }

      const inserted = await database
        .insert(schema.notificationSubscriptions)
        .values(
          input.userIds.map((userId) => ({
            userId,
            groupId: input.groupId,
          })),
        )
        .onConflictDoNothing()
        .returning({ userId: schema.notificationSubscriptions.userId });

      return { subscribedCount: inserted.length };
    }),

    registerNotificationTarget: os.registerNotificationTarget.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "registerNotificationTarget is only callable from a service",
          });
        }
        if (caller.pluginId !== input.ownerPlugin) {
          throw new ORPCError("FORBIDDEN", {
            message: `Plugin ${caller.pluginId} cannot register a target owned by ${input.ownerPlugin}`,
          });
        }
        await database
          .insert(schema.notificationTargets)
          .values({
            targetTypeId: input.targetTypeId,
            ownerPlugin: input.ownerPlugin,
            resourceKind: input.resourceKind,
            parentTargetTypeId: input.parentTargetTypeId,
            legacyGroupIdTemplate: input.legacyGroupIdTemplate,
          })
          .onConflictDoUpdate({
            target: [schema.notificationTargets.targetTypeId],
            set: {
              ownerPlugin: input.ownerPlugin,
              resourceKind: input.resourceKind,
              parentTargetTypeId: input.parentTargetTypeId,
              legacyGroupIdTemplate: input.legacyGroupIdTemplate,
            },
          });
        return { success: true };
      },
    ),

    listNotificationTargets: os.listNotificationTargets.handler(async () => {
      const rows = await database.select().from(schema.notificationTargets);
      return rows.map((row) => ({
        targetTypeId: row.targetTypeId,
        ownerPlugin: row.ownerPlugin,
        resourceKind: row.resourceKind,
        parentTargetTypeId: row.parentTargetTypeId ?? undefined,
        legacyGroupIdTemplate: row.legacyGroupIdTemplate ?? undefined,
      }));
    }),

    upsertNotificationResource: os.upsertNotificationResource.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "upsertNotificationResource is only callable from a service",
          });
        }
        const target = await assertTargetOwnedBy({
          db: database,
          targetTypeId: input.targetTypeId,
          callerPluginId: caller.pluginId,
        });

        await database
          .insert(schema.notificationResources)
          .values({
            targetTypeId: input.targetTypeId,
            resourceKey: input.resource.resourceKey,
            displayLabel: input.resource.displayLabel,
          })
          .onConflictDoUpdate({
            target: [
              schema.notificationResources.targetTypeId,
              schema.notificationResources.resourceKey,
            ],
            set: {
              displayLabel: input.resource.displayLabel,
              upsertedAt: new Date(),
            },
          });

        const [refreshed] = await database
          .select()
          .from(schema.notificationResources)
          .where(
            and(
              eq(schema.notificationResources.targetTypeId, input.targetTypeId),
              eq(
                schema.notificationResources.resourceKey,
                input.resource.resourceKey,
              ),
            ),
          )
          .limit(1);
        if (refreshed) {
          await provisionGroupsForResource({
            db: database,
            targetTypeId: input.targetTypeId,
            resource: refreshed,
          });
          // Run legacy migration seed for any spec freshly bound to this
          // resource (idempotent — subscription_migrations gates it).
          if (target.legacyGroupIdTemplate) {
            const specs = await database
              .select()
              .from(schema.subscriptionSpecs)
              .where(
                eq(schema.subscriptionSpecs.targetTypeId, input.targetTypeId),
              );
            for (const spec of specs) {
              await provisionGroupsForSpec({
                db: database,
                spec,
                legacyGroupIdFor: makeLegacyResolver(
                  target.legacyGroupIdTemplate,
                ),
              });
            }
          }
        }
        return { success: true };
      },
    ),

    upsertNotificationResources: os.upsertNotificationResources.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "upsertNotificationResources is only callable from a service",
          });
        }
        const target = await assertTargetOwnedBy({
          db: database,
          targetTypeId: input.targetTypeId,
          callerPluginId: caller.pluginId,
        });
        if (input.resources.length === 0) return { upserted: 0 };

        await database
          .insert(schema.notificationResources)
          .values(
            input.resources.map((r) => ({
              targetTypeId: input.targetTypeId,
              resourceKey: r.resourceKey,
              displayLabel: r.displayLabel,
            })),
          )
          .onConflictDoUpdate({
            target: [
              schema.notificationResources.targetTypeId,
              schema.notificationResources.resourceKey,
            ],
            set: {
              displayLabel: sql`excluded.display_label`,
              upsertedAt: new Date(),
            },
          });

        // Provision groups for every spec already registered against this
        // target. This is the path catalog hits on platform startup —
        // each plugin then registers its spec and the spec-side
        // provisioning loop seeds it from the legacy groups.
        const specs = await database
          .select()
          .from(schema.subscriptionSpecs)
          .where(eq(schema.subscriptionSpecs.targetTypeId, input.targetTypeId));
        const refreshed = await database
          .select()
          .from(schema.notificationResources)
          .where(
            eq(schema.notificationResources.targetTypeId, input.targetTypeId),
          );

        const legacyResolver = target.legacyGroupIdTemplate
          ? makeLegacyResolver(target.legacyGroupIdTemplate)
          : undefined;

        for (const spec of specs) {
          await provisionGroupsForSpec({
            db: database,
            spec,
            legacyGroupIdFor: legacyResolver,
          });
        }
        // Resources without specs still get tracked (so future spec
        // registrations can bind), but no groups are created for them
        // until at least one spec exists.
        void refreshed;
        return { upserted: input.resources.length };
      },
    ),

    removeNotificationResource: os.removeNotificationResource.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "removeNotificationResource is only callable from a service",
          });
        }
        await assertTargetOwnedBy({
          db: database,
          targetTypeId: input.targetTypeId,
          callerPluginId: caller.pluginId,
        });

        const removedGroups = await teardownGroupsForResource({
          db: database,
          targetTypeId: input.targetTypeId,
          resourceKey: input.resourceKey,
        });
        await database
          .delete(schema.notificationResources)
          .where(
            and(
              eq(schema.notificationResources.targetTypeId, input.targetTypeId),
              eq(
                schema.notificationResources.resourceKey,
                input.resourceKey,
              ),
            ),
          );
        await database
          .delete(schema.notificationResourceParents)
          .where(
            and(
              eq(
                schema.notificationResourceParents.childTargetTypeId,
                input.targetTypeId,
              ),
              eq(
                schema.notificationResourceParents.childResourceKey,
                input.resourceKey,
              ),
            ),
          );
        return { removedGroups };
      },
    ),

    listNotificationResources: os.listNotificationResources.handler(
      async ({ input }) => {
        const rows = await database
          .select()
          .from(schema.notificationResources)
          .where(
            eq(schema.notificationResources.targetTypeId, input.targetTypeId),
          );
        return rows.map((r) => ({
          resourceKey: r.resourceKey,
          displayLabel: r.displayLabel,
        }));
      },
    ),

    setNotificationResourceParents:
      os.setNotificationResourceParents.handler(
        async ({ input, context }) => {
          const caller = context.user as {
            type: string;
            pluginId?: string;
          };
          if (caller.type !== "service" || !caller.pluginId) {
            throw new ORPCError("FORBIDDEN", {
              message:
                "setNotificationResourceParents is only callable from a service",
            });
          }
          await assertTargetOwnedBy({
            db: database,
            targetTypeId: input.childTargetTypeId,
            callerPluginId: caller.pluginId,
          });

          await database
            .delete(schema.notificationResourceParents)
            .where(
              and(
                eq(
                  schema.notificationResourceParents.childTargetTypeId,
                  input.childTargetTypeId,
                ),
                eq(
                  schema.notificationResourceParents.childResourceKey,
                  input.childResourceKey,
                ),
              ),
            );
          if (input.parents.length > 0) {
            await database
              .insert(schema.notificationResourceParents)
              .values(
                input.parents.map((p) => ({
                  childTargetTypeId: input.childTargetTypeId,
                  childResourceKey: input.childResourceKey,
                  parentTargetTypeId: p.parentTargetTypeId,
                  parentResourceKey: p.parentResourceKey,
                })),
              )
              .onConflictDoNothing();
          }
          return { success: true };
        },
      ),

    registerSubscriptionSpec: os.registerSubscriptionSpec.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message: "registerSubscriptionSpec is only callable from a service",
          });
        }
        if (caller.pluginId !== input.ownerPlugin) {
          throw new ORPCError("FORBIDDEN", {
            message: `Plugin ${caller.pluginId} cannot register specs owned by ${input.ownerPlugin}`,
          });
        }

        // The target's owner plugin is guaranteed to have completed
        // its init + afterPluginsReady before this point because the
        // plugin loader derives an init-order edge from each declared
        // subscription spec (`spec.target.ownerPlugin`) to the
        // emitting plugin. If the target is missing here, the
        // emitting plugin failed to declare the spec at register
        // time — surfacing a clear error is the right behavior.
        const [target] = await database
          .select()
          .from(schema.notificationTargets)
          .where(
            eq(schema.notificationTargets.targetTypeId, input.targetTypeId),
          )
          .limit(1);
        if (!target) {
          throw new ORPCError("NOT_FOUND", {
            message: `Target type ${input.targetTypeId} is not registered. Did the emitting plugin declare this spec via env.registerSubscriptionSpecs(...) in its register() block?`,
          });
        }

        await database
          .insert(schema.subscriptionSpecs)
          .values({
            specId: input.specId,
            ownerPlugin: input.ownerPlugin,
            localId: input.localId,
            targetTypeId: input.targetTypeId,
            displayTitle: input.display.title,
            displayDescription: input.display.description,
            displayIconName: input.display.iconName,
          })
          .onConflictDoUpdate({
            target: [schema.subscriptionSpecs.specId],
            set: {
              ownerPlugin: input.ownerPlugin,
              localId: input.localId,
              targetTypeId: input.targetTypeId,
              displayTitle: input.display.title,
              displayDescription: input.display.description,
              displayIconName: input.display.iconName,
            },
          });

        const [spec] = await database
          .select()
          .from(schema.subscriptionSpecs)
          .where(eq(schema.subscriptionSpecs.specId, input.specId))
          .limit(1);
        if (spec) {
          await provisionGroupsForSpec({
            db: database,
            spec,
            legacyGroupIdFor: target.legacyGroupIdTemplate
              ? makeLegacyResolver(target.legacyGroupIdTemplate)
              : undefined,
          });
        }
        return { success: true };
      },
    ),

    listSubscriptionSpecs: os.listSubscriptionSpecs.handler(async () => {
      const rows = await database.select().from(schema.subscriptionSpecs);
      return rows.map((row) => ({
        specId: row.specId,
        ownerPlugin: row.ownerPlugin,
        localId: row.localId,
        targetTypeId: row.targetTypeId,
        display: {
          title: row.displayTitle,
          description: row.displayDescription,
          iconName: row.displayIconName ?? undefined,
        },
      }));
    }),

    notifyForSubscription: os.notifyForSubscription.handler(
      async ({ input, context }) => {
        const caller = context.user as { type: string; pluginId?: string };
        if (caller.type !== "service" || !caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message: "notifyForSubscription is only callable from a service",
          });
        }

        const [spec] = await database
          .select()
          .from(schema.subscriptionSpecs)
          .where(eq(schema.subscriptionSpecs.specId, input.specId))
          .limit(1);
        if (!spec) {
          throw new ORPCError("NOT_FOUND", {
            message: `Subscription spec ${input.specId} is not registered`,
          });
        }
        if (spec.ownerPlugin !== caller.pluginId) {
          throw new ORPCError("FORBIDDEN", {
            message: `Plugin ${caller.pluginId} cannot dispatch under spec ${input.specId} (owned by ${spec.ownerPlugin})`,
          });
        }

        // Validate every resourceKey is a known resource of the spec's
        // target. Unknown keys = drift (resource was never pushed) and
        // would silently produce zero subscribers.
        const known = await database
          .select({ resourceKey: schema.notificationResources.resourceKey })
          .from(schema.notificationResources)
          .where(
            and(
              eq(
                schema.notificationResources.targetTypeId,
                spec.targetTypeId,
              ),
              inArray(
                schema.notificationResources.resourceKey,
                input.resourceKeys,
              ),
            ),
          );
        const knownSet = new Set(known.map((k) => k.resourceKey));
        const missing = input.resourceKeys.filter((k) => !knownSet.has(k));
        if (missing.length > 0) {
          throw new ORPCError("NOT_FOUND", {
            message: `Resources not registered for target ${spec.targetTypeId}: ${missing.join(", ")}`,
          });
        }

        // Primary group ids — one per resourceKey.
        const primaryGroupIds = input.resourceKeys.map((rk) =>
          deriveGroupId({
            ownerPlugin: spec.ownerPlugin,
            localId: spec.localId,
            resourceKey: rk,
          }),
        );

        // Inherited group ids: walk parent edges for each resourceKey,
        // map parent targets to same-plugin specs.
        const inheritedGroupIds = new Set<string>();
        for (const rk of input.resourceKeys) {
          const parts = await resolveInheritedGroupIds({
            db: database,
            spec,
            resourceKey: rk,
          });
          for (const gid of parts) inheritedGroupIds.add(gid);
        }

        const allGroupIds = [...primaryGroupIds, ...inheritedGroupIds];

        const subscribers = await database
          .selectDistinct({ userId: schema.notificationSubscriptions.userId })
          .from(schema.notificationSubscriptions)
          .where(
            inArray(
              schema.notificationSubscriptions.groupId,
              allGroupIds,
            ),
          );

        const excluded = new Set(input.excludeUserIds);
        const recipients = subscribers
          .map((s) => s.userId)
          .filter((uid) => !excluded.has(uid));

        if (recipients.length === 0) {
          return { notifiedCount: 0 };
        }

        const { title, body, importance, action, collapseKey, subjects } =
          input;
        const notificationValues = recipients.map((userId) => ({
          userId,
          title,
          body,
          action,
          importance: importance ?? "info",
          collapseKey,
          subjects,
        }));
        const inserted = await database
          .insert(schema.notifications)
          .values(notificationValues)
          .returning({
            id: schema.notifications.id,
            userId: schema.notifications.userId,
          });

        await Promise.all(
          recipients.map((userId) => cache.invalidateForUser(userId)),
        );

        for (const notification of inserted) {
          void signalService.sendToUser(
            NOTIFICATION_RECEIVED,
            notification.userId,
            {
              id: notification.id,
              title,
              body,
              importance: importance ?? "info",
            },
          );
        }
        for (const userId of recipients) {
          void sendToExternalChannels(userId, {
            title,
            body,
            importance: importance ?? "info",
            action,
            subjects,
          });
        }
        return { notifiedCount: recipients.length };
      },
    ),

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

        // Get user preference for contact resolution
        const pref = await strategyService.getUserPreference(
          userId,
          strategy.qualifiedId
        );

        // Resolve contact based on contactResolution type
        const contact = resolveContact({
          strategy,
          userEmail: user.email,
          userPreference: pref,
        });

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
          importance: notification.importance ?? "info",
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
            logger,
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
            error: extractErrorMessage(error, "Unknown error"),
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
              default: {
                throw new Error(`Unknown contact resolution type: ${resType}`);
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

        // Get strategy config to pass to OAuth functions
        const strategyConfig = await strategyService.getStrategyConfig(
          strategyId
        );
        if (!strategyConfig) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Strategy ${strategyId} is not configured. Please configure it in admin settings first.`,
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

        // Call OAuth config functions with strategy config
        const clientId = strategy.oauth.clientId(strategyConfig);
        const authorizationUrl =
          strategy.oauth.authorizationUrl(strategyConfig);

        // Build authorization URL
        const url = new URL(authorizationUrl);
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
        const contact = resolveContact({
          strategy,
          userEmail: user.email,
          userPreference: pref,
        });

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
          body: `This is a **test notification** from Checkstack!\n\nIf you're seeing this, your *${strategy.displayName}* channel is working correctly.\n\n✅ Markdown formatting\n✅ Emoji support\n✅ Action buttons (below)`,
          importance: "info",
          action: {
            label: "Open Notification Settings",
            url: "/notification/settings",
          },
          type: "notification",
        };

        // Get base URL for action
        const baseUrl = process.env.BASE_URL;
        if (baseUrl && testNotification.action) {
          // For localhost, use a demo URL to show action buttons work
          // (Telegram rejects localhost URLs in action buttons)
          const isLocalhost =
            baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
          if (isLocalhost) {
            testNotification.action.url =
              "https://example.com/notification/settings";
            testNotification.body +=
              "\n\n_Note: Action button links to example\\.com in development since Telegram blocks localhost URLs\\._";
          } else {
            testNotification.action.url = `${baseUrl.replace(/\/$/, "")}${
              testNotification.action.url
            }`;
          }
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
            logger,
          };

        // Send via strategy
        try {
          const result = await strategy.send(sendContext);
          return { success: result.success, error: result.error };
        } catch (error) {
          return {
            success: false,
            error:
              extractErrorMessage(error, "Failed to send test notification"),
          };
        }
      }
    ),
  });
};

export type NotificationRouter = ReturnType<typeof createNotificationRouter>;
