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
        /** Notification body in markdown format */
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        /** Primary action button */
        action: z
          .object({
            label: z.string(),
            url: z.string(),
          })
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
        /** Notification body in markdown format */
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        /** Primary action button */
        action: z
          .object({
            label: z.string(),
            url: z.string(),
          })
          .optional(),
      })
    )
    .output(z.object({ notifiedCount: z.number() })),

  // Send transactional notification via ALL enabled strategies (no internal notification created)
  // For security-critical messages like password reset, 2FA, account verification, etc.
  // Unlike regular notifications, this bypasses user preferences and does not create a bell notification.
  sendTransactional: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userId: z.string().describe("User to notify"),
        notification: z.object({
          title: z.string(),
          body: z.string().describe("Notification body (supports markdown)"),
          action: z
            .object({
              label: z.string(),
              url: z.string(),
            })
            .optional(),
        }),
      })
    )
    .output(
      z.object({
        deliveredCount: z
          .number()
          .describe("Number of strategies that delivered successfully"),
        results: z.array(
          z.object({
            strategyId: z.string(),
            success: z.boolean(),
            error: z.string().optional(),
          })
        ),
      })
    ),

  // ==========================================================================
  // DELIVERY STRATEGY ADMIN ENDPOINTS (userType: "user" with admin permissions)
  // ==========================================================================

  // Get all registered delivery strategies with current config
  getDeliveryStrategies: _base
    .meta({
      userType: "user",
      permissions: [permissions.notificationAdmin.id],
    })
    .output(
      z.array(
        z.object({
          qualifiedId: z.string(),
          displayName: z.string(),
          description: z.string().optional(),
          icon: z.string().optional(),
          ownerPluginId: z.string(),
          contactResolution: z.object({
            type: z.enum([
              "auth-email",
              "auth-provider",
              "user-config",
              "oauth-link",
              "custom",
            ]),
            provider: z.string().optional(),
            field: z.string().optional(),
          }),
          requiresUserConfig: z.boolean(),
          requiresOAuthLink: z.boolean(),
          configSchema: z.record(z.string(), z.unknown()),
          userConfigSchema: z.record(z.string(), z.unknown()).optional(),
          /** Layout config schema for admin customization (logo, colors, etc.) */
          layoutConfigSchema: z.record(z.string(), z.unknown()).optional(),
          enabled: z.boolean(),
          config: z.record(z.string(), z.unknown()).optional(),
          /** Current layout config values */
          layoutConfig: z.record(z.string(), z.unknown()).optional(),
          /** Markdown instructions for admins (setup guides, etc.) */
          adminInstructions: z.string().optional(),
        })
      )
    ),

  // Update strategy enabled state and config
  updateDeliveryStrategy: _base
    .meta({
      userType: "user",
      permissions: [permissions.notificationAdmin.id],
    })
    .input(
      z.object({
        strategyId: z.string().describe("Qualified strategy ID"),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
        /** Layout customization (logo, colors, footer) */
        layoutConfig: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // USER DELIVERY PREFERENCE ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get available delivery channels for current user
  getUserDeliveryChannels: _base.meta({ userType: "user" }).output(
    z.array(
      z.object({
        strategyId: z.string(),
        displayName: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
        contactResolution: z.object({
          type: z.enum([
            "auth-email",
            "auth-provider",
            "user-config",
            "oauth-link",
          ]),
        }),
        enabled: z.boolean(),
        isConfigured: z.boolean(),
        linkedAt: z.coerce.date().optional(),
        /** JSON Schema for user config (for DynamicForm) */
        userConfigSchema: z.record(z.string(), z.unknown()).optional(),
        /** Current user config values */
        userConfig: z.record(z.string(), z.unknown()).optional(),
        /** Markdown instructions for users (connection guides, etc.) */
        userInstructions: z.string().optional(),
      })
    )
  ),

  // Update user's preference for a delivery channel
  setUserDeliveryPreference: _base
    .meta({ userType: "user" })
    .input(
      z.object({
        strategyId: z.string(),
        enabled: z.boolean(),
        userConfig: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.void()),

  // Get OAuth link URL for a strategy (starts OAuth flow)
  getDeliveryOAuthUrl: _base
    .meta({ userType: "user" })
    .input(
      z.object({
        strategyId: z.string(),
        returnUrl: z.string().optional(),
      })
    )
    .output(z.object({ authUrl: z.string() })),

  // Unlink OAuth-connected delivery channel
  unlinkDeliveryChannel: _base
    .meta({ userType: "user" })
    .input(z.object({ strategyId: z.string() }))
    .output(z.void()),

  // Send a test notification to the current user via a specific strategy
  sendTestNotification: _base
    .meta({ userType: "user" })
    .input(z.object({ strategyId: z.string() }))
    .output(
      z.object({
        success: z.boolean(),
        error: z.string().optional(),
      })
    ),
};

// Export contract type
export type NotificationContract = typeof notificationContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(NotificationApi);
export const NotificationApi = createClientDefinition(
  notificationContract,
  pluginMetadata
);
