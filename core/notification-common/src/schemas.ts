import { z } from "zod";

// Notification importance levels
export const ImportanceSchema = z.enum(["info", "warning", "critical"]);
export type Importance = z.infer<typeof ImportanceSchema>;

// Optional health/status hint for affected subjects.
export const SubjectStatusSchema = z.enum([
  "healthy",
  "unhealthy",
  "degraded",
  "unknown",
]);
export type SubjectStatus = z.infer<typeof SubjectStatusSchema>;

// Notification action for CTA buttons
export const NotificationActionSchema = z.object({
  label: z.string(),
  url: z.string(),
});
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

/**
 * An entity affected by a notification (e.g., a system impacted by an
 * incident, or a system on which a shared healthcheck is failing).
 *
 * Subjects render as chips in-app and as native rich elements per
 * notification strategy (e.g., Slack section, Discord embed field, SMTP
 * card). When a notification has no canonical parent CTA (`action` is
 * null), the subjects' URLs are the user's only navigation path.
 *
 * `kind` is an open string so plugins can introduce their own subject
 * types. To prevent clashes between plugins, kinds MUST be namespaced as
 * `<pluginId>.<localKind>` (e.g., `catalog.system`, `incident.incident`,
 * `healthcheck.healthcheck`). Frontend rendering metadata (icon, label)
 * is provided via the plugin-extensible subject-kind registry in
 * `@checkstack/notification-frontend`; unknown kinds fall back to a
 * generic chip with the subject's `name`.
 */
const NAMESPACED_KIND_PATTERN = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/;

export const NotificationSubjectSchema = z.object({
  /**
   * Plugin-namespaced discriminator: `<pluginId>.<localKind>`.
   * Plugins register icon/label for their kinds in the frontend registry.
   */
  kind: z.string().regex(NAMESPACED_KIND_PATTERN, {
    message: "Subject kind must be namespaced as '<pluginId>.<localKind>'",
  }),
  /** Stable identifier for the subject within its kind. */
  id: z.string(),
  /** Human-readable display name. */
  name: z.string(),
  /** Optional deep link to the subject. Recipients without UI access (text channels) just show the name. */
  url: z.string().optional(),
  /**
   * Optional health/status hint, used to color the chip and add an icon.
   * Strategies that cannot render color simply ignore it.
   */
  status: SubjectStatusSchema.optional(),
});
export type NotificationSubject = z.infer<typeof NotificationSubjectSchema>;

// Core notification schema
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  title: z.string(),
  /** Notification body (supports markdown) */
  body: z.string(),
  /** Primary action button */
  action: NotificationActionSchema.optional(),
  importance: ImportanceSchema,
  isRead: z.boolean(),
  /**
   * Collapse key shared by related notifications. Frontend collapses rows
   * with the same (userId, collapseKey) into one card with a "+N updates"
   * badge. Examples: "incident.<id>", "healthcheck.<id>".
   */
  collapseKey: z.string().optional(),
  /** Affected entities (renders as chips / native rich elements). */
  subjects: z.array(NotificationSubjectSchema).optional(),
  createdAt: z.coerce.date(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// Notification group schema (namespaced: "pluginId.groupName")
export const NotificationGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ownerPlugin: z.string(),
  createdAt: z.coerce.date(),
});
export type NotificationGroup = z.infer<typeof NotificationGroupSchema>;

// User subscription to a notification group
export const NotificationSubscriptionSchema = z.object({
  userId: z.string(),
  groupId: z.string(),
  subscribedAt: z.coerce.date(),
});
export type NotificationSubscription = z.infer<
  typeof NotificationSubscriptionSchema
>;

// Enriched subscription with group details for display
export const EnrichedSubscriptionSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupDescription: z.string(),
  ownerPlugin: z.string(),
  subscribedAt: z.coerce.date(),
});
export type EnrichedSubscription = z.infer<typeof EnrichedSubscriptionSchema>;

// Retention settings
export const RetentionSettingsSchema = z.object({
  retentionDays: z.number().min(1).max(365),
  enabled: z.boolean(),
});
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;

// --- Input Schemas ---

export const CreateNotificationInputSchema = z.object({
  userId: z.string(),
  title: z.string(),
  /** Notification body (supports markdown) */
  body: z.string(),
  /** Primary action button */
  action: NotificationActionSchema.optional(),
  importance: ImportanceSchema.default("info"),
});
export type CreateNotificationInput = z.infer<
  typeof CreateNotificationInputSchema
>;

export const NotificationGroupInputSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  description: z.string(),
});
export type NotificationGroupInput = z.infer<
  typeof NotificationGroupInputSchema
>;

// Pagination schema for listing notifications
export const PaginationInputSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  unreadOnly: z.boolean().default(false),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

// --- Notification Strategy Schemas ---

// Contact resolution type
export const ContactResolutionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth-email") }),
  z.object({ type: z.literal("auth-provider"), provider: z.string() }),
  z.object({ type: z.literal("user-config"), field: z.string() }),
  z.object({ type: z.literal("oauth-link") }),
]);
export type ContactResolution = z.infer<typeof ContactResolutionSchema>;

// Strategy info for API responses
export const NotificationStrategyInfoSchema = z.object({
  /** Qualified ID: {pluginId}.{strategyId} */
  qualifiedId: z.string(),
  /** Display name */
  displayName: z.string(),
  /** Description */
  description: z.string().optional(),
  /** Lucide icon name */
  icon: z.string().optional(),
  /** Owner plugin ID */
  ownerPluginId: z.string(),
  /** How contact info is resolved */
  contactResolution: ContactResolutionSchema,
  /** Whether strategy requires user config */
  requiresUserConfig: z.boolean(),
  /** Whether strategy requires OAuth linking */
  requiresOAuthLink: z.boolean(),
  /** JSON Schema for admin config (for DynamicForm) */
  configSchema: z.record(z.string(), z.unknown()),
  /** JSON Schema for user config (if applicable) */
  userConfigSchema: z.record(z.string(), z.unknown()).optional(),
});
export type NotificationStrategyInfo = z.infer<
  typeof NotificationStrategyInfoSchema
>;

// User's preference for a specific strategy
export const UserNotificationPreferenceSchema = z.object({
  strategyId: z.string(),
  enabled: z.boolean(),
  /** Whether this channel is ready (has contact info / is linked) */
  isConfigured: z.boolean(),
  /** When external account was linked (for OAuth strategies) */
  linkedAt: z.coerce.date().optional(),
});
export type UserNotificationPreference = z.infer<
  typeof UserNotificationPreferenceSchema
>;

// External notification payload
export const ExternalNotificationPayloadSchema = z.object({
  title: z.string(),
  /** Markdown-formatted body content */
  body: z.string().optional(),
  importance: ImportanceSchema.default("info"),
  /** Optional call-to-action */
  action: z
    .object({
      label: z.string(),
      url: z.string(),
    })
    .optional(),
  /** Source type for filtering (e.g., "healthcheck.alert", "password-reset") */
  type: z.string(),
});
export type ExternalNotificationPayload = z.infer<
  typeof ExternalNotificationPayloadSchema
>;

// External delivery result
export const ExternalDeliveryResultSchema = z.object({
  sent: z.number(),
  failed: z.number(),
  skipped: z.number(),
});
export type ExternalDeliveryResult = z.infer<
  typeof ExternalDeliveryResultSchema
>;

// Transactional message result
export const TransactionalResultSchema = z.object({
  success: z.boolean(),
  externalId: z.string().optional(),
  error: z.string().optional(),
});
export type TransactionalResult = z.infer<typeof TransactionalResultSchema>;
