/**
 * Integration Provider Types
 *
 * These types define the contract for integration provider plugins.
 * All backend-only types live here - frontend uses Zod schemas from integration-common.
 */
import { z } from "zod";
import type { Versioned, Logger, Hook } from "@checkmate-monitor/backend-api";

// =============================================================================
// Integration Event Definition Types
// =============================================================================

/**
 * Metadata for registering a hook as an integration event.
 * Plugins use this to expose their hooks for external webhook subscriptions.
 */
export interface IntegrationEventDefinition<T = unknown> {
  /** The hook to expose (from the owning plugin) */
  hook: Hook<T>;

  /** Human-readable name for the UI */
  displayName: string;

  /** Description of when this event fires */
  description?: string;

  /** Category for UI grouping (e.g., "Health", "Incidents", "Maintenance") */
  category?: string;

  /** Zod schema for the payload (used for UI preview and validation) */
  payloadSchema: z.ZodType<T>;

  /**
   * Optional: Transform hook payload before sending to webhooks.
   * Use this to enrich the payload with additional context or
   * redact sensitive fields.
   */
  transformPayload?: (payload: T) => Record<string, unknown>;
}

// =============================================================================
// Integration Provider Types
// =============================================================================

/**
 * Context passed to the provider's deliver() method.
 */
export interface IntegrationDeliveryContext<TConfig = unknown> {
  event: {
    /** Fully qualified event ID */
    eventId: string;
    /** Event payload (possibly transformed) */
    payload: Record<string, unknown>;
    /** ISO timestamp when the event was emitted */
    timestamp: string;
    /** Unique ID for this delivery attempt */
    deliveryId: string;
  };
  subscription: {
    /** Subscription ID */
    id: string;
    /** Subscription name */
    name: string;
  };
  /** Provider-specific configuration */
  providerConfig: TConfig;
  /** Scoped logger for delivery tracing */
  logger: Logger;
  /**
   * Get connection credentials by ID (for providers with connectionSchema).
   * Only available when provider has a connectionSchema defined.
   */
  getConnectionWithCredentials?: (
    connectionId: string
  ) => Promise<{ config: Record<string, unknown> } | undefined>;
}

/**
 * Result of a provider delivery attempt.
 */
export interface IntegrationDeliveryResult {
  success: boolean;
  /** External ID returned by the target system (e.g., Jira issue key) */
  externalId?: string;
  /** Error message if delivery failed */
  error?: string;
  /** Milliseconds to wait before retrying (if applicable) */
  retryAfterMs?: number;
}

/**
 * Result of testing a provider connection.
 */
export interface TestConnectionResult {
  success: boolean;
  message?: string;
}

/**
 * Documentation that helps users implement their endpoint for this provider.
 */
export interface ProviderDocumentation {
  /** Brief setup instructions (rendered as markdown) */
  setupGuide?: string;
  /** Example request body (JSON string for syntax highlighting) */
  examplePayload?: string;
  /** HTTP headers that will be sent with each request */
  headers?: Array<{ name: string; description: string }>;
  /** Link to external documentation */
  externalDocsUrl?: string;
}

/**
 * Option returned by getConnectionOptions for dynamic dropdowns.
 */
export interface ConnectionOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Parameters for getConnectionOptions method.
 */
export interface GetConnectionOptionsParams {
  /** The connection ID to use for fetching options */
  connectionId: string;
  /** Name of the resolver (matches x-options-resolver in schema) */
  resolverName: string;
  /** Current form values for dependent fields */
  context: Record<string, unknown>;
  /**
   * Get connection credentials by ID.
   * Provided by the integration backend for providers to access connection config.
   */
  getConnectionWithCredentials: (
    connectionId: string
  ) => Promise<{ config: Record<string, unknown> } | undefined>;
}

/**
 * Integration provider definition.
 * Providers define how to deliver events to specific external systems.
 *
 * @template TConfig - Per-subscription configuration type
 * @template TConnection - Site-wide connection configuration type (optional)
 */
export interface IntegrationProvider<
  TConfig = unknown,
  TConnection = undefined
> {
  /** Local identifier, namespaced on registration to {pluginId}.{id} */
  id: string;

  /** Display name for UI */
  displayName: string;

  /** Description of what this provider does */
  description?: string;

  /** Lucide icon name for UI */
  icon?: string;

  /** Per-subscription configuration schema */
  config: Versioned<TConfig>;

  /**
   * Optional site-wide connection schema.
   * When provided, the platform will:
   * - Store connections centrally via ConfigService
   * - Show a "Connections" management UI
   * - Add a connection dropdown to subscription config
   */
  connectionSchema?: Versioned<TConnection>;

  /**
   * Events this provider can handle.
   * If undefined, provider accepts all events.
   * Event IDs are fully qualified: {pluginId}.{hookId}
   */
  supportedEvents?: string[];

  /**
   * Optional documentation to help users configure their endpoints.
   * Displayed in the UI when creating/editing subscriptions.
   */
  documentation?: ProviderDocumentation;

  /**
   * Transform and deliver the event to the external system.
   */
  deliver(
    context: IntegrationDeliveryContext<TConfig>
  ): Promise<IntegrationDeliveryResult>;

  /**
   * Optional: Test the provider configuration.
   * Called when admin clicks "Test Connection" in the UI.
   */
  testConnection?(config: TConfig): Promise<TestConnectionResult>;

  /**
   * Optional: Fetch dynamic options for cascading dropdowns.
   * Called when subscription config has fields with x-options-resolver.
   * Only applicable when connectionSchema is defined.
   */
  getConnectionOptions?(
    params: GetConnectionOptionsParams
  ): Promise<ConnectionOption[]>;
}

/**
 * Registered provider with full namespace information.
 */
export interface RegisteredIntegrationProvider<TConfig = unknown>
  extends IntegrationProvider<TConfig> {
  /** Fully qualified ID: {pluginId}.{id} */
  qualifiedId: string;

  /** Plugin that registered this provider */
  ownerPluginId: string;
}

/**
 * Registered integration event with full namespace information.
 */
export interface RegisteredIntegrationEvent<T = unknown> {
  /** Fully qualified event ID: {pluginId}.{hookId} */
  eventId: string;

  /** Original hook reference */
  hook: Hook<T>;

  /** Plugin that registered this event */
  ownerPluginId: string;

  /** UI metadata */
  displayName: string;
  description?: string;
  category?: string;

  /** JSON Schema for payload (derived from Zod) */
  payloadJsonSchema: Record<string, unknown>;

  /** Original Zod schema */
  payloadSchema: z.ZodType<T>;

  /** Optional payload transformer */
  transformPayload?: (payload: T) => Record<string, unknown>;
}
