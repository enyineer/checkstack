import {
  os,
  authedProcedure,
  permissionMiddleware,
  zod,
  type ConfigService,
  toJsonSchema,
} from "@checkmate/backend-api";
import {
  PaginationInputSchema,
  RetentionSettingsSchema,
  permissions,
} from "@checkmate/notification-common";
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

// Create middleware for permissions
const notificationRead = permissionMiddleware(permissions.notificationRead.id);
const notificationAdmin = permissionMiddleware(
  permissions.notificationAdmin.id
);

export const createNotificationRouter = (
  database: NodePgDatabase<typeof schema>,
  configService: ConfigService
) => {
  return os.router({
    // --- User Notification Endpoints ---

    getNotifications: authedProcedure
      .use(notificationRead)
      .input(PaginationInputSchema)
      .handler(async ({ input, context }) => {
        const userId = context.user.id as string;

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
      }),

    getUnreadCount: authedProcedure
      .use(notificationRead)
      .handler(async ({ context }) => {
        const userId = context.user.id as string;
        const count = await getUnreadCount(database, userId);
        return { count };
      }),

    markAsRead: authedProcedure
      .use(notificationRead)
      .input(zod.object({ notificationId: zod.string().uuid().optional() }))
      .handler(async ({ input, context }) => {
        const userId = context.user.id as string;
        await markAsRead(database, userId, input.notificationId);
      }),

    deleteNotification: authedProcedure
      .use(notificationRead)
      .input(zod.object({ notificationId: zod.string().uuid() }))
      .handler(async ({ input, context }) => {
        const userId = context.user.id as string;
        await deleteNotification(database, userId, input.notificationId);
      }),

    // --- Group & Subscription Endpoints (any authenticated user) ---

    getGroups: authedProcedure.use(notificationRead).handler(async () => {
      const groups = await getAllGroups(database);
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        ownerPlugin: g.ownerPlugin,
        createdAt: g.createdAt,
      }));
    }),

    getSubscriptions: authedProcedure
      .use(notificationRead)
      .handler(async ({ context }) => {
        const userId = context.user.id as string;
        const subscriptions = await getEnrichedUserSubscriptions(
          database,
          userId
        );
        return subscriptions;
      }),

    subscribe: authedProcedure
      .use(notificationRead)
      .input(zod.object({ groupId: zod.string() }))
      .handler(async ({ input, context }) => {
        const userId = context.user.id as string;
        await subscribeToGroup(database, userId, input.groupId);
      }),

    unsubscribe: authedProcedure
      .use(notificationRead)
      .input(zod.object({ groupId: zod.string() }))
      .handler(async ({ input, context }) => {
        const userId = context.user.id as string;
        await unsubscribeFromGroup(database, userId, input.groupId);
      }),

    // --- Admin Settings Endpoints ---

    getRetentionSchema: authedProcedure.use(notificationAdmin).handler(() => {
      // Return the JSON schema for DynamicForm
      return toJsonSchema(retentionConfigV1);
    }),

    getRetentionSettings: authedProcedure
      .use(notificationAdmin)
      .handler(async () => {
        const config = await configService.get(
          RETENTION_CONFIG_ID,
          retentionConfigV1,
          RETENTION_CONFIG_VERSION
        );
        // Return defaults if no config stored
        return config ?? { enabled: false, retentionDays: 30 };
      }),

    setRetentionSettings: authedProcedure
      .use(notificationAdmin)
      .input(RetentionSettingsSchema)
      .handler(async ({ input }) => {
        await configService.set(
          RETENTION_CONFIG_ID,
          retentionConfigV1,
          RETENTION_CONFIG_VERSION,
          input
        );
      }),

    // --- Backend-to-Backend Group Management ---

    createGroup: authedProcedure
      .input(
        zod.object({
          groupId: zod.string(),
          name: zod.string(),
          description: zod.string(),
          ownerPlugin: zod.string(),
        })
      )
      .handler(async ({ input }) => {
        // Create the namespaced group ID
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

    deleteGroup: authedProcedure
      .input(
        zod.object({
          groupId: zod.string(),
          ownerPlugin: zod.string(),
        })
      )
      .handler(async ({ input }) => {
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
  });
};

export type NotificationRouter = ReturnType<typeof createNotificationRouter>;
