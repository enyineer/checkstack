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
  NotificationSubjectSchema,
} from "./schemas";

// Shared input fragments for the notify* procedures.
const NotificationActionInput = z
  .object({
    label: z.string(),
    url: z.string(),
  })
  .optional();
const NotificationCollapseKeyInput = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional collapse key. Notifications with the same (userId, collapseKey) collapse into one card on the frontend. Convention: '<pluginId>.<entityKind>.<entityId>'.",
  );
const NotificationSubjectsInput = z
  .array(NotificationSubjectSchema)
  .min(1)
  .describe(
    "Affected entities. Required so every dispatched notification can be cross-referenced with its subscription spec / resource. Renders as chips in-app and as native rich elements per strategy.",
  );

// ─── Subscription-spec / target contract types ───────────────────────────────

const SubscriptionDisplaySchema = z.object({
  title: z.string(),
  description: z.string(),
  iconName: z.string().optional(),
});

const SubscriptionSpecRecordSchema = z.object({
  specId: z.string(),
  ownerPlugin: z.string(),
  localId: z.string(),
  targetTypeId: z.string(),
  display: SubscriptionDisplaySchema,
});

const NotificationTargetRecordSchema = z.object({
  targetTypeId: z.string(),
  ownerPlugin: z.string(),
  resourceKind: z.string(),
  parentTargetTypeId: z.string().optional(),
  legacyGroupIdTemplate: z
    .string()
    .optional()
    .describe(
      "Template like 'catalog.system.{resourceKey}'. Backend substitutes {resourceKey} once per (spec × resource) to seed initial subscribers.",
    ),
});

const NotificationResourceSchema = z.object({
  resourceKey: z.string(),
  displayLabel: z.string(),
});

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

  /**
   * Bulk subscription-status lookup for the current user. Used by the
   * generic `<SubscriptionRow>` component when several specs from
   * different plugins render against the same resource — each spec's row
   * needs to know "am I subscribed to this groupId?" but doing N
   * roundtrips would be wasteful. Pass every candidate groupId in one
   * call and receive a map back.
   */
  getMySubscriptionStatus: proc({
    operationType: "query",
    userType: "user",
    access: [],
  })
    .input(z.object({ groupIds: z.array(z.string()) }))
    .output(z.record(z.string(), z.boolean())),

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

  /**
   * Subscribe a batch of users to a group in one call. Used by plugins
   * during bootstrap/migration when establishing default subscribers for
   * a newly-introduced group (e.g. mirroring existing catalog system
   * subscribers onto a derived anomaly group). Idempotent.
   */
  bulkSubscribe: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        groupId: z.string().describe("Full namespaced group ID"),
        userIds: z.array(z.string()),
      })
    )
    .output(z.object({ subscribedCount: z.number() })),

  /**
   * Register (or update) a notification target type. Target owners call
   * this on startup. notification-backend persists the metadata + tracks
   * registered targets so it can route resource lifecycle events and
   * resolve dispatch parents. Idempotent.
   */
  registerNotificationTarget: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(NotificationTargetRecordSchema)
    .output(z.object({ success: z.boolean() })),

  /** Lists every registered target type — used by audit/settings UIs. */
  listNotificationTargets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.array(NotificationTargetRecordSchema)),

  /**
   * Push (or refresh) a single resource of a target type. Owners call
   * this on resource creation and on rename. notification-backend
   * provisions a notification group for every registered spec whose
   * target matches, runs the legacy-migration seed if declared, and
   * stores the display label for audit UIs.
   */
  upsertNotificationResource: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        targetTypeId: z.string(),
        resource: NotificationResourceSchema,
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * Bulk variant. Used by target owners on platform startup to seed all
   * existing resources at once without N round-trips.
   */
  upsertNotificationResources: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        targetTypeId: z.string(),
        resources: z.array(NotificationResourceSchema),
      }),
    )
    .output(z.object({ upserted: z.number() })),

  /**
   * Remove a resource — notification-backend deletes every group derived
   * from it across every registered spec whose target matches.
   */
  removeNotificationResource: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        targetTypeId: z.string(),
        resourceKey: z.string(),
      }),
    )
    .output(z.object({ removedGroups: z.number() })),

  /**
   * Replace the full parent set for a child resource. Owners call this
   * whenever a child's parents change — catalog calls it on
   * `addSystemToGroup` / `removeSystemFromGroup` / system create. The
   * dispatcher reads these edges (plus the spec→target mapping) at
   * dispatch time to compute inherited group ids without re-walking
   * through the owner.
   */
  setNotificationResourceParents: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        childTargetTypeId: z.string(),
        childResourceKey: z.string(),
        parents: z.array(
          z.object({
            parentTargetTypeId: z.string(),
            parentResourceKey: z.string(),
          }),
        ),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * List known resources for a target type. Read-only convenience used
   * by the settings page audit and by the spec-registration flow during
   * group provisioning.
   */
  listNotificationResources: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(z.object({ targetTypeId: z.string() }))
    .output(z.array(NotificationResourceSchema)),

  /**
   * Register (or update) a notification subscription spec. Plugins call
   * this on startup once per spec they own. notification-backend joins
   * the spec against every existing resource of `targetTypeId` and
   * provisions per-resource groups. Idempotent.
   */
  registerSubscriptionSpec: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(SubscriptionSpecRecordSchema)
    .output(z.object({ success: z.boolean() })),

  /**
   * Returns every currently-registered spec. Used by the settings UI to
   * decorate subscription rows with display metadata even for plugins
   * whose frontend isn't loaded.
   */
  listSubscriptionSpecs: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.array(SubscriptionSpecRecordSchema)),

  /**
   * The sanctioned dispatch path. Caller supplies a registered specId
   * and one or more resource keys; notification-backend resolves
   * primary group ids, walks the target's parent chain to compute
   * inherited group ids (joined against the same plugin's specs whose
   * target matches the parent target), unions subscribers, applies
   * `excludeUserIds`, and delivers.
   *
   * Enforcement:
   * - specId must exist and be owned by the calling service plugin.
   * - resourceKeys must reference resources currently registered for
   *   the spec's target — backend rejects unknown keys.
   */
  notifyForSubscription: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        specId: z.string(),
        resourceKeys: z.array(z.string()).min(1),
        excludeUserIds: z.array(z.string()).optional(),
        title: z.string(),
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        action: NotificationActionInput,
        collapseKey: NotificationCollapseKeyInput,
        subjects: NotificationSubjectsInput,
      }),
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
          importance: z
            .enum(["info", "warning", "critical"])
            .optional()
            .describe("Severity of the message; defaults to 'info'"),
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
