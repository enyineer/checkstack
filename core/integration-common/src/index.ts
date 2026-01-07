// Schemas - Zod validators for API contracts
export {
  // Delivery status
  DeliveryStatusSchema,
  type DeliveryStatus,
  // Webhook subscriptions
  WebhookSubscriptionSchema,
  type WebhookSubscription,
  CreateSubscriptionInputSchema,
  type CreateSubscriptionInput,
  UpdateSubscriptionInputSchema,
  type UpdateSubscriptionInput,
  // Delivery logs
  DeliveryLogSchema,
  type DeliveryLog,
  DeliveryLogQueryInputSchema,
  type DeliveryLogQueryInput,
  // Provider info
  IntegrationProviderInfoSchema,
  type IntegrationProviderInfo,
  // Event info
  IntegrationEventInfoSchema,
  type IntegrationEventInfo,
  // Result schemas (for API validation)
  IntegrationDeliveryResultSchema,
  TestConnectionResultSchema,
  // Connection management
  ProviderConnectionSchema,
  type ProviderConnection,
  ProviderConnectionRedactedSchema,
  type ProviderConnectionRedacted,
  CreateConnectionInputSchema,
  type CreateConnectionInput,
  UpdateConnectionInputSchema,
  type UpdateConnectionInput,
  GetConnectionOptionsInputSchema,
  type GetConnectionOptionsInput,
  ConnectionOptionSchema,
  type ConnectionOptionOutput,
} from "./schemas";

// NOTE: All backend-only types (IntegrationProvider, IntegrationDeliveryContext, etc.)
// are defined in @checkmate-monitor/integration-backend/provider-types.
// Frontend code should only use the Zod schemas above for API contracts.

// Permissions
export * from "./permissions";

// RPC Contract
export * from "./rpc-contract";

// Signals
export * from "./signals";

// Plugin Metadata
export * from "./plugin-metadata";

// Routes
export { integrationRoutes } from "./routes";
