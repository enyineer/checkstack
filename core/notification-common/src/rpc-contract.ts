import { oc } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./permissions";
import { pluginMetadata } from "./plugin-metadata";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkmate/common";
import {
  NotificationSchema,
  NotificationGroupSchema,
  EnrichedSubscriptionSchema,
  RetentionSettingsSchema,
  PaginationInputSchema,
} from "./schemas";

// Base builder with full metadata support (userType + permissions)
const _base = oc.$meta<ProcedureMetadata>({});

// Notification RPC Contract
export const notificationContract = {
  // ==========================================================================
  // USER NOTIFICATION ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get current user's notifications (paginated)
  getNotifications: _base
    .meta({
      userType: "user",
    })
    .input(PaginationInputSchema)
    .output(
      z.object({
        notifications: z.array(NotificationSchema),
        total: z.number(),
      })
    ),

  // Get unread count for badge
  getUnreadCount: _base
    .meta({
      userType: "user",
    })
    .output(z.object({ count: z.number() })),

  // Mark notification(s) as read
  markAsRead: _base
    .meta({
      userType: "user",
    })
    .input(
      z.object({
        notificationId: z.string().uuid().optional(), // If not provided, mark all as read
      })
    )
    .output(z.void()),

  // Delete a notification
  deleteNotification: _base
    .meta({
      userType: "user",
    })
    .input(z.object({ notificationId: z.string().uuid() }))
    .output(z.void()),

  // ==========================================================================
  // GROUP & SUBSCRIPTION ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get all available notification groups
  getGroups: _base
    .meta({
      userType: "authenticated", // Services can read groups too
    })
    .output(z.array(NotificationGroupSchema)),

  // Get current user's subscriptions with group details
  getSubscriptions: _base
    .meta({
      userType: "user",
    })
    .output(z.array(EnrichedSubscriptionSchema)),

  // Subscribe to a notification group
  subscribe: _base
    .meta({
      userType: "user",
    })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // Unsubscribe from a notification group
  unsubscribe: _base
    .meta({
      userType: "user",
    })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // ==========================================================================
  // ADMIN SETTINGS ENDPOINTS (userType: "user" with admin permissions)
  // ==========================================================================

  // Get retention schema for DynamicForm
  getRetentionSchema: _base
    .meta({
      userType: "user",
      permissions: [permissions.notificationAdmin.id],
    })
    .output(z.record(z.string(), z.unknown())),

  // Get retention settings
  getRetentionSettings: _base
    .meta({
      userType: "user",
      permissions: [permissions.notificationAdmin.id],
    })
    .output(RetentionSettingsSchema),

  // Update retention settings
  setRetentionSettings: _base
    .meta({
      userType: "user",
      permissions: [permissions.notificationAdmin.id],
    })
    .input(RetentionSettingsSchema)
    .output(z.void()),

  // ==========================================================================
  // BACKEND-TO-BACKEND GROUP MANAGEMENT (userType: "service")
  // ==========================================================================

  // Create a notification group (for plugins to register their groups)
  createGroup: _base
    .meta({ userType: "service" })
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
    .meta({ userType: "service" })
    .input(
      z.object({
        groupId: z.string().describe("Full namespaced group ID to delete"),
        ownerPlugin: z
          .string()
          .describe("Plugin ID that owns this group (for validation)"),
      })
    )
    .output(z.object({ success: z.boolean() })),

  // Get subscribers for a specific notification group
  getGroupSubscribers: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        groupId: z
          .string()
          .describe("Full namespaced group ID (e.g., 'catalog.system.123')"),
      })
    )
    .output(z.object({ userIds: z.array(z.string()) })),

  // Send notifications to a list of users (deduplicated by caller)
  notifyUsers: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userIds: z.array(z.string()),
        title: z.string(),
        description: z.string(),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        actions: z
          .array(
            z.object({
              label: z.string(),
              href: z.string(),
              variant: z
                .enum(["primary", "secondary", "destructive"])
                .optional(),
            })
          )
          .optional(),
      })
    )
    .output(z.object({ notifiedCount: z.number() })),

  // Notify all subscribers of multiple groups (deduplicates internally)
  // Use this when an event affects multiple groups and you want to avoid
  // duplicate notifications for users subscribed to multiple affected groups.
  notifyGroups: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        groupIds: z
          .array(z.string())
          .describe("Full namespaced group IDs to notify"),
        title: z.string(),
        description: z.string(),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        actions: z
          .array(
            z.object({
              label: z.string(),
              href: z.string(),
              variant: z
                .enum(["primary", "secondary", "destructive"])
                .optional(),
            })
          )
          .optional(),
      })
    )
    .output(z.object({ notifiedCount: z.number() })),
};

// Export contract type
export type NotificationContract = typeof notificationContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(NotificationApi);
export const NotificationApi = createClientDefinition(
  notificationContract,
  pluginMetadata
);
