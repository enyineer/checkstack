import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./permissions";
import {
  NotificationSchema,
  NotificationGroupSchema,
  EnrichedSubscriptionSchema,
  RetentionSettingsSchema,
  PaginationInputSchema,
} from "./schemas";

// Permission metadata type
export interface NotificationMetadata {
  permissions?: string[];
}

// Base builder with metadata support
const _base = oc.$meta<NotificationMetadata>({});

// Notification RPC Contract
export const notificationContract = {
  // --- User Notification Endpoints ---

  // Get current user's notifications (paginated)
  getNotifications: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .input(PaginationInputSchema)
    .output(
      z.object({
        notifications: z.array(NotificationSchema),
        total: z.number(),
      })
    ),

  // Get unread count for badge
  getUnreadCount: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .output(z.object({ count: z.number() })),

  // Mark notification(s) as read
  markAsRead: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .input(
      z.object({
        notificationId: z.string().uuid().optional(), // If not provided, mark all as read
      })
    )
    .output(z.void()),

  // Delete a notification
  deleteNotification: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .input(z.object({ notificationId: z.string().uuid() }))
    .output(z.void()),

  // --- Group & Subscription Endpoints ---

  // Get all available notification groups
  getGroups: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .output(z.array(NotificationGroupSchema)),

  // Get current user's subscriptions with group details
  getSubscriptions: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .output(z.array(EnrichedSubscriptionSchema)),

  // Subscribe to a notification group (any authenticated user)
  subscribe: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // Unsubscribe from a notification group (any authenticated user)
  unsubscribe: _base
    .meta({ permissions: [permissions.notificationRead.id] })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // --- Admin Settings Endpoints ---

  // Get retention schema for DynamicForm
  getRetentionSchema: _base
    .meta({ permissions: [permissions.notificationAdmin.id] })
    .output(z.record(z.string(), z.unknown())),

  // Get retention settings
  getRetentionSettings: _base
    .meta({ permissions: [permissions.notificationAdmin.id] })
    .output(RetentionSettingsSchema),

  // Update retention settings
  setRetentionSettings: _base
    .meta({ permissions: [permissions.notificationAdmin.id] })
    .input(RetentionSettingsSchema)
    .output(z.void()),

  // --- Backend-to-Backend Group Management ---

  // Create a notification group (for plugins to register their groups)
  createGroup: _base
    .meta({ permissions: [] }) // Service-to-service, checked by service token
    .input(
      z.object({
        groupId: z
          .string()
          .describe(
            "Unique group identifier, will be namespaced with ownerPlugin"
          ),
        name: z.string().describe("Display name for the group"),
        description: z
          .string()
          .describe("Description of what notifications this group provides"),
        ownerPlugin: z.string().describe("Plugin ID that owns this group"),
      })
    )
    .output(z.object({ id: z.string() })),

  // Delete a notification group
  deleteGroup: _base
    .meta({ permissions: [] }) // Service-to-service, checked by service token
    .input(
      z.object({
        groupId: z.string().describe("Full namespaced group ID to delete"),
        ownerPlugin: z
          .string()
          .describe("Plugin ID that owns this group (for validation)"),
      })
    )
    .output(z.object({ success: z.boolean() })),
};

// Export contract type for frontend
export type NotificationContract = typeof notificationContract;

// Export typed client for frontend/backend communication
export type NotificationClient = ContractRouterClient<
  typeof notificationContract
>;
