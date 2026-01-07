import { z } from "zod";

// =============================================================================
// Webhook Subscription Schemas
// =============================================================================

/** Status of a webhook delivery attempt */
export const DeliveryStatusSchema = z.enum([
  "pending",
  "success",
  "failed",
  "retrying",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

/** Webhook subscription configuration */
export const WebhookSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),

  /** Fully qualified provider ID: {pluginId}.{providerId} */
  providerId: z.string(),

  /** Provider-specific configuration (validated against provider schema) */
  providerConfig: z.record(z.string(), z.unknown()),

  /** Events to subscribe to (empty = all events) */
  eventTypes: z.array(z.string()).default([]),

  /** Optional: Filter by system IDs */
  systemFilter: z.array(z.string()).optional(),

  /** Subscription state */
  enabled: z.boolean().default(true),

  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>;

/** Input for creating a webhook subscription */
export const CreateSubscriptionInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  providerId: z.string(),
  providerConfig: z.record(z.string(), z.unknown()),
  eventTypes: z.array(z.string()).optional(),
  systemFilter: z.array(z.string()).optional(),
});
export type CreateSubscriptionInput = z.infer<
  typeof CreateSubscriptionInputSchema
>;

/** Input for updating a webhook subscription */
export const UpdateSubscriptionInputSchema = z.object({
  id: z.string(),
  updates: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    providerConfig: z.record(z.string(), z.unknown()).optional(),
    eventTypes: z.array(z.string()).optional(),
    systemFilter: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
});
export type UpdateSubscriptionInput = z.infer<
  typeof UpdateSubscriptionInputSchema
>;

// =============================================================================
// Delivery Log Schemas
// =============================================================================

/** Delivery log entry */
export const DeliveryLogSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  subscriptionName: z.string().optional(),

  eventType: z.string(),
  eventPayload: z.record(z.string(), z.unknown()),

  status: DeliveryStatusSchema,
  attempts: z.number(),
  lastAttemptAt: z.coerce.date().optional(),
  nextRetryAt: z.coerce.date().optional(),

  externalId: z.string().optional(),
  errorMessage: z.string().optional(),

  createdAt: z.coerce.date(),
});
export type DeliveryLog = z.infer<typeof DeliveryLogSchema>;

/** Input for querying delivery logs */
export const DeliveryLogQueryInputSchema = z.object({
  subscriptionId: z.string().optional(),
  eventType: z.string().optional(),
  status: DeliveryStatusSchema.optional(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});
export type DeliveryLogQueryInput = z.infer<typeof DeliveryLogQueryInputSchema>;

// =============================================================================
// Integration Provider Schemas
// =============================================================================

/** Documentation schema for provider setup help */
export const ProviderDocumentationSchema = z
  .object({
    /** Brief setup instructions (rendered as markdown) */
    setupGuide: z.string().optional(),
    /** Example request body (JSON string for syntax highlighting) */
    examplePayload: z.string().optional(),
    /** HTTP headers that will be sent with each request */
    headers: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
        })
      )
      .optional(),
    /** Link to external documentation */
    externalDocsUrl: z.string().url().optional(),
  })
  .optional();

/** Provider info for API responses */
export const IntegrationProviderInfoSchema = z.object({
  /** Qualified ID: {pluginId}.{providerId} */
  qualifiedId: z.string(),
  /** Display name */
  displayName: z.string(),
  /** Description */
  description: z.string().optional(),
  /** Lucide icon name */
  icon: z.string().optional(),
  /** Owner plugin ID */
  ownerPluginId: z.string(),
  /** Events this provider can handle (undefined = all) */
  supportedEvents: z.array(z.string()).optional(),
  /** JSON Schema for provider config (for DynamicForm) */
  configSchema: z.record(z.string(), z.unknown()),
  /** Whether this provider has a connectionSchema (requires connection management) */
  hasConnectionSchema: z.boolean().default(false),
  /** JSON Schema for connection config (for DynamicForm in connection management) */
  connectionSchema: z.record(z.string(), z.unknown()).optional(),
  /** Optional documentation to help users configure their endpoints */
  documentation: ProviderDocumentationSchema,
});
export type IntegrationProviderInfo = z.infer<
  typeof IntegrationProviderInfoSchema
>;

// =============================================================================
// Provider Connection Schemas
// =============================================================================

/** Provider connection record (site-wide credentials) */
export const ProviderConnectionSchema = z.object({
  /** Unique connection ID */
  id: z.string(),
  /** Qualified provider ID this connection belongs to */
  providerId: z.string(),
  /** Display name for this connection */
  name: z.string().min(1).max(100),
  /** Connection configuration (provider-specific, secrets redacted for API) */
  config: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

/** Redacted connection for API responses (no secrets) */
export const ProviderConnectionRedactedSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  name: z.string(),
  /** Redacted config (secret fields removed) */
  configPreview: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProviderConnectionRedacted = z.infer<
  typeof ProviderConnectionRedactedSchema
>;

/** Input for creating a provider connection */
export const CreateConnectionInputSchema = z.object({
  /** Qualified provider ID */
  providerId: z.string(),
  /** Display name */
  name: z.string().min(1).max(100),
  /** Provider-specific connection config (validated against connectionSchema) */
  config: z.record(z.string(), z.unknown()),
});
export type CreateConnectionInput = z.infer<typeof CreateConnectionInputSchema>;

/** Input for updating a provider connection */
export const UpdateConnectionInputSchema = z.object({
  connectionId: z.string(),
  updates: z.object({
    name: z.string().min(1).max(100).optional(),
    /** Partial config update (only provided fields are updated) */
    config: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionInputSchema>;

/** Input for getting connection options (cascading dropdowns) */
export const GetConnectionOptionsInputSchema = z.object({
  providerId: z.string(),
  connectionId: z.string(),
  resolverName: z.string(),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type GetConnectionOptionsInput = z.infer<
  typeof GetConnectionOptionsInputSchema
>;

/** Option returned from getConnectionOptions */
export const ConnectionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type ConnectionOptionOutput = z.infer<typeof ConnectionOptionSchema>;

// =============================================================================
// Integration Event Schemas
// =============================================================================

/** Integration event info for API responses */
export const IntegrationEventInfoSchema = z.object({
  /** Fully qualified event ID: {pluginId}.{hookId} */
  eventId: z.string(),
  /** Display name for UI */
  displayName: z.string(),
  /** Description of when this event fires */
  description: z.string().optional(),
  /** Category for UI grouping */
  category: z.string().optional(),
  /** Owner plugin ID */
  ownerPluginId: z.string(),
  /** JSON Schema for payload preview */
  payloadSchema: z.record(z.string(), z.unknown()),
});
export type IntegrationEventInfo = z.infer<typeof IntegrationEventInfoSchema>;

// =============================================================================
// Delivery Result Schema
// =============================================================================

/** Result of a provider delivery attempt */
export const IntegrationDeliveryResultSchema = z.object({
  success: z.boolean(),
  externalId: z.string().optional(),
  error: z.string().optional(),
  retryAfterMs: z.number().optional(),
});
export type IntegrationDeliveryResult = z.infer<
  typeof IntegrationDeliveryResultSchema
>;

// =============================================================================
// Test Connection Schema
// =============================================================================

/** Result of testing a provider connection */
export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
