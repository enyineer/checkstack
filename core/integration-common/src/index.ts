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
} from "./schemas";

// Types - TypeScript interfaces for provider implementations
export type {
  IntegrationLogger,
  HookReference,
  IntegrationEventDefinition,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
  VersionedConfig,
  IntegrationProvider,
  RegisteredIntegrationProvider,
  RegisteredIntegrationEvent,
} from "./types";

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
