import { z } from "zod";
import { notificationAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import { createClientDefinition, proc } from "@checkstack/common";
import {
  NotificationSchema,
  NotificationGroupSchema,
  EnrichedSubscriptionSchema,
  RetentionSettingsSchema,
  PaginationInputSchema,
} from "./schemas";

// Notification RPC Contract
export const notificationContract = {
  // ==========================================================================
  // USER NOTIFICATION ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get current user's notifications (paginated)
  getNotifications: proc({
    operationType: "query",
    userType: "user",
    access: [],
  })
    .input(PaginationInputSchema)
    .output(
      z.object({
        notifications: z.array(NotificationSchema),
        total: z.number(),
      })
    ),

  // Get unread count for badge
  getUnreadCount: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(z.object({ count: z.number() })),

  // Mark notification(s) as read
  markAsRead: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        notificationId: z.string().uuid().optional(), // If not provided, mark all as read
      })
    )
    .output(z.void()),

  // Delete a notification
  deleteNotification: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(z.object({ notificationId: z.string().uuid() }))
    .output(z.void()),

  // ==========================================================================
  // GROUP & SUBSCRIPTION ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get all available notification groups
  getGroups: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.array(NotificationGroupSchema)),

  // Get current user's subscriptions with group details
  getSubscriptions: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(z.array(EnrichedSubscriptionSchema)),

  // Subscribe to a notification group
  subscribe: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // Unsubscribe from a notification group
  unsubscribe: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(z.object({ groupId: z.string() }))
    .output(z.void()),

  // ==========================================================================
  // ADMIN SETTINGS ENDPOINTS (userType: "user" with admin access)
  // ==========================================================================

  // Get retention schema for DynamicForm
  getRetentionSchema: proc({
    operationType: "query",
    userType: "user",
    access: [notificationAccess.admin],
  }).output(z.record(z.string(), z.unknown())),

  // Get retention settings
  getRetentionSettings: proc({
    operationType: "query",
    userType: "user",
    access: [notificationAccess.admin],
  }).output(RetentionSettingsSchema),

  // Update retention settings
  setRetentionSettings: proc({
    operationType: "mutation",
    userType: "user",
    access: [notificationAccess.admin],
  })
    .input(RetentionSettingsSchema)
    .output(z.void()),

  // ==========================================================================
  // BACKEND-TO-BACKEND GROUP MANAGEMENT (userType: "service")
  // ==========================================================================

  // Create a notification group (for plugins to register their groups)
  createGroup: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
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
  deleteGroup: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
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
  getGroupSubscribers: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        groupId: z
          .string()
          .describe("Full namespaced group ID (e.g., 'catalog.system.123')"),
      })
    )
    .output(z.object({ userIds: z.array(z.string()) })),

  // Send notifications to a list of users (deduplicated by caller)
  notifyUsers: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userIds: z.array(z.string()),
        title: z.string(),
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
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
  notifyGroups: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        groupIds: z
          .array(z.string())
          .describe("Full namespaced group IDs to notify"),
        title: z.string(),
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        action: z
          .object({
            label: z.string(),
            url: z.string(),
          })
          .optional(),
      })
    )
    .output(z.object({ notifiedCount: z.number() })),

  // Send transactional notification via ALL enabled strategies
  sendTransactional: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
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
  // DELIVERY STRATEGY ADMIN ENDPOINTS (userType: "user" with admin access)
  // ==========================================================================

  // Get all registered delivery strategies with current config
  getDeliveryStrategies: proc({
    operationType: "query",
    userType: "user",
    access: [notificationAccess.admin],
  }).output(
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
        layoutConfigSchema: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
        layoutConfig: z.record(z.string(), z.unknown()).optional(),
        adminInstructions: z.string().optional(),
      })
    )
  ),

  // Update strategy enabled state and config
  updateDeliveryStrategy: proc({
    operationType: "mutation",
    userType: "user",
    access: [notificationAccess.admin],
  })
    .input(
      z.object({
        strategyId: z.string().describe("Qualified strategy ID"),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
        layoutConfig: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // USER DELIVERY PREFERENCE ENDPOINTS (userType: "user")
  // ==========================================================================

  // Get available delivery channels for current user
  getUserDeliveryChannels: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(
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
        userConfigSchema: z.record(z.string(), z.unknown()).optional(),
        userConfig: z.record(z.string(), z.unknown()).optional(),
        userInstructions: z.string().optional(),
      })
    )
  ),

  // Update user's preference for a delivery channel
  setUserDeliveryPreference: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        strategyId: z.string(),
        enabled: z.boolean(),
        userConfig: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.void()),

  // Get OAuth link URL for a strategy (starts OAuth flow)
  getDeliveryOAuthUrl: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        strategyId: z.string(),
        returnUrl: z.string().optional(),
      })
    )
    .output(z.object({ authUrl: z.string() })),

  // Unlink OAuth-connected delivery channel
  unlinkDeliveryChannel: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(z.object({ strategyId: z.string() }))
    .output(z.void()),

  // Send a test notification to the current user via a specific strategy
  sendTestNotification: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
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
