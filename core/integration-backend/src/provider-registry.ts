import type { PluginMetadata } from "@checkstack/common";
import { toJsonSchema, validateSecretIds } from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  RegisteredIntegrationProvider,
} from "./provider-types";

/**
 * Registry for integration providers — now scoped to connection
 * management only. Per-subscription `config` + `deliver` moved to the
 * Automation platform's `ActionDefinition` (see
 * `@checkstack/automation-backend`); the legacy subscription system is
 * gone.
 */
export interface IntegrationProviderRegistry {
  /**
   * Register an integration provider.
   * Called via the extension point during plugin registration.
   */
  register(
    provider: IntegrationProvider<unknown>,
    pluginMetadata: PluginMetadata
  ): void;

  /** Get all registered providers */
  getProviders(): RegisteredIntegrationProvider<unknown>[];

  /** Get a specific provider by its fully qualified ID */
  getProvider(
    qualifiedId: string
  ): RegisteredIntegrationProvider<unknown> | undefined;

  /** Check if a provider is registered */
  hasProvider(qualifiedId: string): boolean;

  /** Get the JSON Schema for a provider's connection config (if any) */
  getProviderConnectionSchema(
    qualifiedId: string
  ): Record<string, unknown> | undefined;
}

/**
 * Create a new integration provider registry instance.
 */
export function createIntegrationProviderRegistry(): IntegrationProviderRegistry {
  const providers = new Map<string, RegisteredIntegrationProvider<unknown>>();
  const connectionSchemas = new Map<string, Record<string, unknown>>();

  return {
    register(
      provider: IntegrationProvider<unknown>,
      pluginMetadata: PluginMetadata
    ): void {
      const qualifiedId = `${pluginMetadata.pluginId}.${provider.id}`;

      const registered: RegisteredIntegrationProvider<unknown> = {
        ...provider,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
      };

      providers.set(qualifiedId, registered);

      if (provider.connectionSchema) {
        // Load-time guard: every x-secret credential field must carry a stable,
        // unique x-secret-id (configSecret), or its extracted secret would
        // mis-key/orphan on the connection scope.
        validateSecretIds({
          schema: provider.connectionSchema.schema,
          label: `connection:${qualifiedId}`,
        });
        const connectionJsonSchema = toJsonSchema(
          provider.connectionSchema.schema
        );
        connectionSchemas.set(qualifiedId, connectionJsonSchema);
      }
    },

    getProviders(): RegisteredIntegrationProvider<unknown>[] {
      return [...providers.values()];
    },

    getProvider(
      qualifiedId: string
    ): RegisteredIntegrationProvider<unknown> | undefined {
      return providers.get(qualifiedId);
    },

    hasProvider(qualifiedId: string): boolean {
      return providers.has(qualifiedId);
    },

    getProviderConnectionSchema(
      qualifiedId: string
    ): Record<string, unknown> | undefined {
      return connectionSchemas.get(qualifiedId);
    },
  };
}
