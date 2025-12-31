import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./permissions";
import type { ProcedureMetadata } from "@checkmate/common";
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
};

// Export contract type for frontend
export type NotificationContract = typeof notificationContract;

// Export typed client for frontend/backend communication
export type NotificationClient = ContractRouterClient<
  typeof notificationContract
>;
