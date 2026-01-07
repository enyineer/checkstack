import type { PluginMetadata } from "@checkmate-monitor/common";
import { toJsonSchema } from "@checkmate-monitor/backend-api";
import type {
  IntegrationProvider,
  RegisteredIntegrationProvider,
} from "./provider-types";

/**
 * Registry for integration providers.
 * Plugins register their providers here to enable webhook delivery to external systems.
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

  /** Get the JSON Schema for a provider's config */
  getProviderConfigSchema(
    qualifiedId: string
  ): Record<string, unknown> | undefined;

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
  const configSchemas = new Map<string, Record<string, unknown>>();
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

      // Convert the provider's config schema to JSON Schema for UI
      // Uses the platform's toJsonSchema which handles secrets/colors
      const jsonSchema = toJsonSchema(provider.config.schema);
      configSchemas.set(qualifiedId, jsonSchema);

      // Also convert connection schema if present
      if (provider.connectionSchema) {
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

    getProviderConfigSchema(
      qualifiedId: string
    ): Record<string, unknown> | undefined {
      return configSchemas.get(qualifiedId);
    },

    getProviderConnectionSchema(
      qualifiedId: string
    ): Record<string, unknown> | undefined {
      return connectionSchemas.get(qualifiedId);
    },
  };
}
