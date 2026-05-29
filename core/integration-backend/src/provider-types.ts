/**
 * Integration Provider Types — connection-only after the Automation
 * Platform migration. Per-event delivery context types are gone; the
 * Automation engine's `ActionExecutionContext` replaces them.
 */
import type { Versioned, Logger } from "@checkstack/backend-api";
import type { LucideIconName } from "@checkstack/common";

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
  /** Logger for logging */
  logger: Logger;
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
 * Connection-provider definition. Plugins register one per external
 * system to expose a connection schema, test endpoint, and dynamic
 * dropdown resolvers used by the Automation editor's config forms.
 *
 * The legacy `config` (per-subscription) + `deliver` fields are gone:
 * those responsibilities moved to the Automation platform's
 * `ActionDefinition` (see `@checkstack/automation-backend`). Existing
 * subscriptions are migrated to automations on boot — see
 * `core/automation-backend/src/migration/`.
 *
 * @template TConnection - Site-wide connection configuration type
 */
export interface IntegrationProvider<TConnection = undefined> {
  /** Local identifier, namespaced on registration to {pluginId}.{id} */
  id: string;

  /** Display name for UI */
  displayName: string;

  /** Description of what this provider does */
  description?: string;

  /** Lucide icon name in PascalCase (e.g., 'Webhook') */
  icon?: LucideIconName;

  /**
   * Optional site-wide connection schema.
   * When provided, the platform will:
   * - Store connections centrally via ConfigService
   * - Show a "Connections" management UI
   * - Make connections selectable in automation action config forms
   */
  connectionSchema?: Versioned<TConnection>;

  /**
   * Optional documentation to help users configure connections.
   * Displayed on the connections page.
   */
  documentation?: ProviderDocumentation;

  /**
   * Optional: Test the connection configuration.
   * Called when admin clicks "Test Connection" in the connections UI.
   * Only applicable when connectionSchema is defined.
   */
  testConnection?(config: TConnection): Promise<TestConnectionResult>;

  /**
   * Optional: Fetch dynamic options for cascading dropdowns inside
   * automation action config forms. Resolver names are declared via
   * `configString({ "x-options-resolver": "name" })` in action configs.
   */
  getConnectionOptions?(
    params: GetConnectionOptionsParams
  ): Promise<ConnectionOption[]>;
}

/**
 * Registered provider with full namespace information.
 */
export interface RegisteredIntegrationProvider<TConnection = unknown>
  extends IntegrationProvider<TConnection> {
  /** Fully qualified ID: {pluginId}.{id} */
  qualifiedId: string;

  /** Plugin that registered this provider */
  ownerPluginId: string;
}

