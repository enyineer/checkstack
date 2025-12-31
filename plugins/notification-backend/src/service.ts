import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, count, desc, lt } from "drizzle-orm";
import type {
  NotificationAction,
  Importance,
} from "@checkmate/notification-common";
import { NOTIFICATION_RECEIVED } from "@checkmate/notification-common";
import type { SignalService } from "@checkmate/signal-common";
import * as schema from "./schema";

export interface NotifyUserOptions {
  userId: string;
  title: string;
  description: string;
  actions?: NotificationAction[];
  importance?: Importance;
}

export interface NotifyGroupOptions {
  groupName: string;
  title: string;
  description: string;
  actions?: NotificationAction[];
  importance?: Importance;
}

export interface CreateGroupOptions {
  groupId: string;
  name: string;
  description: string;
}

/**
 * Scoped NotificationService - each plugin gets an instance prefixed with its pluginId
 */
export class NotificationService {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly pluginId: string,
    private readonly signalService?: SignalService
  ) {}

  /**
   * Get the namespaced group ID for this plugin
   */
  private getNamespacedGroupId(groupName: string): string {
    return `${this.pluginId}.${groupName}`;
  }

  /**
   * Send notification to a single user
   */
  async notifyUser(options: NotifyUserOptions): Promise<string> {
    const {
      userId,
      title,
      description,
      actions,
      importance = "info",
    } = options;

    const result = await this.db
      .insert(schema.notifications)
      .values({
        userId,
        title,
        description,
        actions,
        importance,
      })
      .returning({ id: schema.notifications.id });

    const notificationId = result[0].id;

    // Emit realtime signal to the user
    if (this.signalService) {
      void this.signalService.sendToUser(NOTIFICATION_RECEIVED, userId, {
        id: notificationId,
        title,
        description,
        importance,
      });
    }

    return notificationId;
  }

  /**
   * Send notification to all subscribers of a group.
   * Group name is auto-prefixed with plugin namespace.
   */
  async notifyGroup(options: NotifyGroupOptions): Promise<number> {
    const {
      groupName,
      title,
      description,
      actions,
      importance = "info",
    } = options;

    const groupId = this.getNamespacedGroupId(groupName);

    // Get all subscribers for this group
    const subscribers = await this.db
      .select({ userId: schema.notificationSubscriptions.userId })
      .from(schema.notificationSubscriptions)
      .where(eq(schema.notificationSubscriptions.groupId, groupId));

    if (subscribers.length === 0) {
      return 0;
    }

    // Create a notification for each subscriber
    const notificationValues = subscribers.map((sub) => ({
      userId: sub.userId,
      title,
      description,
      actions,
      importance,
      groupId,
    }));

    await this.db.insert(schema.notifications).values(notificationValues);

    return subscribers.length;
  }

  /**
   * Broadcast notification to ALL users.
   * This requires fetching all user IDs - typically done via auth-backend RPC.
   * For now, accepts a list of user IDs to notify.
   */
  async broadcast(
    userIds: string[],
    options: Omit<NotifyUserOptions, "userId">
  ): Promise<number> {
    const { title, description, actions, importance = "info" } = options;

    if (userIds.length === 0) {
      return 0;
    }

    const notificationValues = userIds.map((userId) => ({
      userId,
      title,
      description,
      actions,
      importance,
    }));

    await this.db.insert(schema.notifications).values(notificationValues);

    return userIds.length;
  }

  /**
   * Create a notification group.
   * The groupId is auto-prefixed with plugin namespace.
   */
  async createGroup(options: CreateGroupOptions): Promise<string> {
    const { groupId, name, description } = options;
    const namespacedId = this.getNamespacedGroupId(groupId);

    await this.db
      .insert(schema.notificationGroups)
      .values({
        id: namespacedId,
        name,
        description,
        ownerPlugin: this.pluginId,
      })
      .onConflictDoUpdate({
        target: [schema.notificationGroups.id],
        set: {
          name,
          description,
        },
      });

    return namespacedId;
  }

  /**
   * Delete a notification group (only groups owned by this plugin)
   */
  async deleteGroup(groupName: string): Promise<boolean> {
    const groupId = this.getNamespacedGroupId(groupName);

    const result = await this.db
      .delete(schema.notificationGroups)
      .where(
        and(
          eq(schema.notificationGroups.id, groupId),
          eq(schema.notificationGroups.ownerPlugin, this.pluginId)
        )
      )
      .returning({ id: schema.notificationGroups.id });

    return result.length > 0;
  }

  /**
   * Get all subscribers for a group (only groups owned by this plugin)
   */
  async getGroupSubscribers(groupName: string): Promise<string[]> {
    const groupId = this.getNamespacedGroupId(groupName);

    // Verify the group is owned by this plugin
    const group = await this.db
      .select({ id: schema.notificationGroups.id })
      .from(schema.notificationGroups)
      .where(
        and(
          eq(schema.notificationGroups.id, groupId),
          eq(schema.notificationGroups.ownerPlugin, this.pluginId)
        )
      )
      .limit(1);

    if (group.length === 0) {
      return [];
    }

    const subscribers = await this.db
      .select({ userId: schema.notificationSubscriptions.userId })
      .from(schema.notificationSubscriptions)
      .where(eq(schema.notificationSubscriptions.groupId, groupId));

    return subscribers.map((s) => s.userId);
  }
}

/**
 * Factory function to create a scoped NotificationService for a plugin
 */
export function createNotificationService(
  db: NodePgDatabase<typeof schema>,
  pluginId: string,
  signalService?: SignalService
): NotificationService {
  return new NotificationService(db, pluginId, signalService);
}

// --- Internal service functions for router (not namespaced) ---

/**
 * Get notifications for a user (for router use)
 */
export async function getUserNotifications(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  options: { limit: number; offset: number; unreadOnly: boolean }
): Promise<{
  notifications: (typeof schema.notifications.$inferSelect)[];
  total: number;
}> {
  const conditions = [eq(schema.notifications.userId, userId)];

  if (options.unreadOnly) {
    conditions.push(eq(schema.notifications.isRead, false));
  }

  const whereClause = and(...conditions);

  const [notificationsResult, countResult] = await Promise.all([
    db
      .select()
      .from(schema.notifications)
      .where(whereClause)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(options.limit)
      .offset(options.offset),
    db.select({ count: count() }).from(schema.notifications).where(whereClause),
  ]);

  return {
    notifications: notificationsResult,
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Get unread count for a user
 */
export async function getUnreadCount(
  db: NodePgDatabase<typeof schema>,
  userId: string
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, false)
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * Mark notification(s) as read
 */
export async function markAsRead(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  notificationId?: string
): Promise<void> {
  const whereClause = notificationId
    ? and(
        eq(schema.notifications.id, notificationId),
        eq(schema.notifications.userId, userId)
      )
    : eq(schema.notifications.userId, userId);

  await db
    .update(schema.notifications)
    .set({ isRead: true })
    .where(whereClause);
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  notificationId: string
): Promise<void> {
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.id, notificationId),
        eq(schema.notifications.userId, userId)
      )
    );
}

/**
 * Get all notification groups
 */
export async function getAllGroups(
  db: NodePgDatabase<typeof schema>
): Promise<(typeof schema.notificationGroups.$inferSelect)[]> {
  return db.select().from(schema.notificationGroups);
}

/**
 * Get user's subscriptions with enriched group details
 */
export async function getEnrichedUserSubscriptions(
  db: NodePgDatabase<typeof schema>,
  userId: string
): Promise<
  {
    groupId: string;
    groupName: string;
    groupDescription: string;
    ownerPlugin: string;
    subscribedAt: Date;
  }[]
> {
  const result = await db
    .select({
      groupId: schema.notificationSubscriptions.groupId,
      groupName: schema.notificationGroups.name,
      groupDescription: schema.notificationGroups.description,
      ownerPlugin: schema.notificationGroups.ownerPlugin,
      subscribedAt: schema.notificationSubscriptions.subscribedAt,
    })
    .from(schema.notificationSubscriptions)
    .innerJoin(
      schema.notificationGroups,
      eq(schema.notificationSubscriptions.groupId, schema.notificationGroups.id)
    )
    .where(eq(schema.notificationSubscriptions.userId, userId));

  return result;
}

/**
 * Subscribe user to a group
 */
export async function subscribeToGroup(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  groupId: string
): Promise<void> {
  await db
    .insert(schema.notificationSubscriptions)
    .values({
      userId,
      groupId,
    })
    .onConflictDoNothing();
}

/**
 * Unsubscribe user from a group
 */
export async function unsubscribeFromGroup(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  groupId: string
): Promise<void> {
  await db
    .delete(schema.notificationSubscriptions)
    .where(
      and(
        eq(schema.notificationSubscriptions.userId, userId),
        eq(schema.notificationSubscriptions.groupId, groupId)
      )
    );
}

/**
 * Purge old notifications based on retention policy.
 * Retention settings should be fetched from ConfigService and passed in.
 */
export async function purgeOldNotifications({
  db,
  enabled,
  retentionDays,
}: {
  db: NodePgDatabase<typeof schema>;
  enabled: boolean;
  retentionDays: number;
}): Promise<number> {
  if (!enabled) {
    return 0;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await db
    .delete(schema.notifications)
    .where(lt(schema.notifications.createdAt, cutoffDate))
    .returning({ id: schema.notifications.id });

  return result.length;
}
