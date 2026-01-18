import type { SafeDatabase } from "@checkstack/backend-api";
import { eq, and, count, desc, lt } from "drizzle-orm";
import * as schema from "./schema";

// --- Internal service functions for router (not namespaced) ---

/**
 * Get notifications for a user (for router use)
 */
export async function getUserNotifications(
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>
): Promise<(typeof schema.notificationGroups.$inferSelect)[]> {
  return db.select().from(schema.notificationGroups);
}

/**
 * Get user's subscriptions with enriched group details
 */
export async function getEnrichedUserSubscriptions(
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>,
  userId: string,
  groupId: string
): Promise<void> {
  // First verify the group exists
  const group = await db
    .select({ id: schema.notificationGroups.id })
    .from(schema.notificationGroups)
    .where(eq(schema.notificationGroups.id, groupId))
    .limit(1);

  if (group.length === 0) {
    throw new Error(`Notification group '${groupId}' does not exist`);
  }

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
  db: SafeDatabase<typeof schema>,
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
  db: SafeDatabase<typeof schema>;
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
