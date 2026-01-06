import { createSignal } from "@checkmate-monitor/signal-common";
import { z } from "zod";
import { ImportanceSchema } from "./schemas";

/**
 * Signal emitted when a new notification is received.
 * Used to update the notification bell count and show realtime notifications.
 */
export const NOTIFICATION_RECEIVED = createSignal(
  "notification.received",
  z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    importance: ImportanceSchema,
  })
);

/**
 * Signal emitted when the unread notification count changes.
 * Used to update the badge count on the notification bell.
 */
export const NOTIFICATION_COUNT_CHANGED = createSignal(
  "notification.countChanged",
  z.object({
    unreadCount: z.number(),
  })
);

/**
 * Signal emitted when a notification is marked as read.
 */
export const NOTIFICATION_READ = createSignal(
  "notification.read",
  z.object({
    notificationId: z.string().optional(), // undefined means all marked as read
  })
);
