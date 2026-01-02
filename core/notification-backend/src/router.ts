import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
  type RealUser,
  type ConfigService,
  toJsonSchema,
} from "@checkmate/backend-api";
import { notificationContract } from "@checkmate/notification-common";
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

/**
 * Creates the notification router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
 */
export const createNotificationRouter = (
  database: NodePgDatabase<typeof schema>,
  configService: ConfigService
) => {
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
            description: n.description,
            actions: n.actions ?? undefined,
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
      await subscribeToGroup(database, userId, input.groupId);
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
      const { userIds, title, description, importance, actions } = input;

      if (userIds.length === 0) {
        return { notifiedCount: 0 };
      }

      const notificationValues = userIds.map((userId) => ({
        userId,
        title,
        description,
        actions,
        importance: importance ?? "info",
      }));

      await database.insert(schema.notifications).values(notificationValues);

      return { notifiedCount: userIds.length };
    }),

    // Notify all subscribers of multiple groups with internal deduplication
    notifyGroups: os.notifyGroups.handler(async ({ input }) => {
      const { groupIds, title, description, importance, actions } = input;
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
        description,
        actions,
        importance: importance ?? "info",
      }));

      await database.insert(schema.notifications).values(notificationValues);

      return { notifiedCount: subscribers.length };
    }),
  });
};

export type NotificationRouter = ReturnType<typeof createNotificationRouter>;
