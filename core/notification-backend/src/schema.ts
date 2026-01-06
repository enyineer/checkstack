import {
  pgTable,
  text,
  boolean,
  uuid,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import type { NotificationAction } from "@checkmate-monitor/notification-common";

// User notifications table
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(), // No FK - cross-schema limitation
  title: text("title").notNull(),
  /** Notification body content (supports markdown) */
  body: text("body").notNull(),
  /** Single primary action button */
  action: jsonb("action").$type<NotificationAction | null>(),
  importance: text("importance").notNull().default("info"), // 'info' | 'warning' | 'critical'
  isRead: boolean("is_read").notNull().default(false),
  groupId: text("group_id"), // Namespaced: "pluginId.groupName"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Notification groups (created by plugins)
// ID is namespaced: "pluginId.groupName"
export const notificationGroups = pgTable("notification_groups", {
  id: text("id").primaryKey(), // Namespaced: "pluginId.groupName"
  name: text("name").notNull(),
  description: text("description").notNull(),
  ownerPlugin: text("owner_plugin").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User-group subscriptions
export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    userId: text("user_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => notificationGroups.id, { onDelete: "cascade" }),
    subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.groupId] }),
  })
);

// Note: User notification preferences are now stored via ConfigService
// using the user-pref.{userId}.{strategyId} pattern for automatic
// secret encryption of OAuth tokens.
