/**
 * Generic connection store for integration providers.
 * Each connection is stored individually using ConfigService with the provider's
 * actual connectionSchema, which enables proper secret encryption and redaction.
 *
 * Key pattern: integration_connection_{providerId}_{connectionId}
 * Index pattern: integration_connection_index_{providerId} (tracks connection IDs)
 */
import { z } from "zod";
import type {
  ConfigService,
  Logger,
  Migration,
} from "@checkmate-monitor/backend-api";
import type { IntegrationProviderRegistry } from "./provider-registry";
import type {
  ProviderConnection,
  ProviderConnectionRedacted,
} from "@checkmate-monitor/integration-common";

// Schema for connection metadata (stored separately from config)
const ConnectionMetadataSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Schema for provider's connection index (list of connection IDs)
const ConnectionIndexSchema = z.object({
  connectionIds: z.array(z.string()),
});

const CONNECTION_STORAGE_VERSION = 1;

/**
 * Configuration key for a single connection's config.
 */
function getConnectionConfigKey(
  providerId: string,
  connectionId: string
): string {
  const sanitizedProvider = providerId.replaceAll(".", "_");
  return `integration_connection_${sanitizedProvider}_${connectionId}`;
}

/**
 * Configuration key for a single connection's metadata.
 */
function getConnectionMetadataKey(
  providerId: string,
  connectionId: string
): string {
  const sanitizedProvider = providerId.replaceAll(".", "_");
  return `integration_connection_meta_${sanitizedProvider}_${connectionId}`;
}

/**
 * Configuration key for provider's connection index.
 */
function getConnectionIndexKey(providerId: string): string {
  const sanitizedProvider = providerId.replaceAll(".", "_");
  return `integration_connection_index_${sanitizedProvider}`;
}

export interface ConnectionStore {
  /** List all connections for a provider (secrets redacted) */
  listConnections(providerId: string): Promise<ProviderConnectionRedacted[]>;

  /** Get a single connection (secrets redacted) */
  getConnection(
    connectionId: string
  ): Promise<ProviderConnectionRedacted | undefined>;

  /** Get a connection with full credentials (internal use only) */
  getConnectionWithCredentials(
    connectionId: string
  ): Promise<ProviderConnection | undefined>;

  /** Create a new connection */
  createConnection(params: {
    providerId: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<ProviderConnection>;

  /** Update an existing connection */
  updateConnection(params: {
    connectionId: string;
    updates: {
      name?: string;
      config?: Record<string, unknown>;
    };
  }): Promise<ProviderConnection>;

  /** Delete a connection */
  deleteConnection(connectionId: string): Promise<boolean>;

  /** Find which provider owns a connection */
  findConnectionProvider(connectionId: string): Promise<string | undefined>;
}

interface ConnectionStoreDeps {
  configService: ConfigService;
  providerRegistry: IntegrationProviderRegistry;
  logger: Logger;
}

export function createConnectionStore(
  deps: ConnectionStoreDeps
): ConnectionStore {
  const { configService, providerRegistry, logger } = deps;

  // Cache of connectionId -> providerId for efficient lookups
  const connectionProviderCache = new Map<string, string>();

  /**
   * Get the list of connection IDs for a provider.
   */
  async function getConnectionIndex(providerId: string): Promise<string[]> {
    const key = getConnectionIndexKey(providerId);
    const data = await configService.get(
      key,
      ConnectionIndexSchema,
      CONNECTION_STORAGE_VERSION
    );
    return data?.connectionIds ?? [];
  }

  /**
   * Save the list of connection IDs for a provider.
   */
  async function setConnectionIndex(
    providerId: string,
    connectionIds: string[]
  ): Promise<void> {
    const key = getConnectionIndexKey(providerId);
    await configService.set(
      key,
      ConnectionIndexSchema,
      CONNECTION_STORAGE_VERSION,
      { connectionIds }
    );
  }

  /**
   * Get connection metadata.
   */
  async function getConnectionMetadata(
    providerId: string,
    connectionId: string
  ): Promise<z.infer<typeof ConnectionMetadataSchema> | undefined> {
    const key = getConnectionMetadataKey(providerId, connectionId);
    return configService.get(
      key,
      ConnectionMetadataSchema,
      CONNECTION_STORAGE_VERSION
    );
  }

  /**
   * Save connection metadata.
   */
  async function setConnectionMetadata(
    providerId: string,
    connectionId: string,
    metadata: z.infer<typeof ConnectionMetadataSchema>
  ): Promise<void> {
    const key = getConnectionMetadataKey(providerId, connectionId);
    await configService.set(
      key,
      ConnectionMetadataSchema,
      CONNECTION_STORAGE_VERSION,
      metadata
    );
  }

  /**
   * Get connection config (with full credentials).
   */
  async function getConnectionConfigRaw(
    providerId: string,
    connectionId: string
  ): Promise<Record<string, unknown> | undefined> {
    const provider = providerRegistry.getProvider(providerId);
    if (!provider?.connectionSchema) return undefined;

    const key = getConnectionConfigKey(providerId, connectionId);
    const config = await configService.get(
      key,
      provider.connectionSchema.schema,
      provider.connectionSchema.version,
      provider.connectionSchema.migrations as
        | Migration<unknown, unknown>[]
        | undefined
    );
    return config as Record<string, unknown> | undefined;
  }

  /**
   * Get connection config (secrets redacted).
   */
  async function getConnectionConfigRedacted(
    providerId: string,
    connectionId: string
  ): Promise<Record<string, unknown> | undefined> {
    const provider = providerRegistry.getProvider(providerId);
    if (!provider?.connectionSchema) return undefined;

    const key = getConnectionConfigKey(providerId, connectionId);
    const config = await configService.getRedacted(
      key,
      provider.connectionSchema.schema,
      provider.connectionSchema.version,
      provider.connectionSchema.migrations as
        | Migration<unknown, unknown>[]
        | undefined
    );
    return config as Record<string, unknown> | undefined;
  }

  /**
   * Save connection config.
   */
  async function setConnectionConfig(
    providerId: string,
    connectionId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const provider = providerRegistry.getProvider(providerId);
    if (!provider?.connectionSchema) {
      throw new Error(`Provider ${providerId} has no connectionSchema`);
    }

    const key = getConnectionConfigKey(providerId, connectionId);
    await configService.set(
      key,
      provider.connectionSchema.schema,
      provider.connectionSchema.version,
      config
    );
  }

  /**
   * Delete connection config and metadata.
   */
  async function deleteConnectionData(
    providerId: string,
    connectionId: string
  ): Promise<void> {
    const configKey = getConnectionConfigKey(providerId, connectionId);
    await configService.delete(configKey);

    const metaKey = getConnectionMetadataKey(providerId, connectionId);
    await configService.delete(metaKey);
  }

  return {
    async listConnections(providerId) {
      // Validate provider exists and has connectionSchema
      const provider = providerRegistry.getProvider(providerId);
      if (!provider?.connectionSchema) {
        return [];
      }

      const connectionIds = await getConnectionIndex(providerId);
      const connections: ProviderConnectionRedacted[] = [];

      for (const connectionId of connectionIds) {
        const metadata = await getConnectionMetadata(providerId, connectionId);
        const configPreview = await getConnectionConfigRedacted(
          providerId,
          connectionId
        );

        if (metadata && configPreview) {
          connectionProviderCache.set(connectionId, providerId);
          connections.push({
            id: metadata.id,
            providerId: metadata.providerId,
            name: metadata.name,
            configPreview,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
          });
        }
      }

      return connections;
    },

    async getConnection(connectionId) {
      let providerId = connectionProviderCache.get(connectionId);

      if (!providerId) {
        providerId = await this.findConnectionProvider(connectionId);
      }

      if (!providerId) {
        return;
      }

      const metadata = await getConnectionMetadata(providerId, connectionId);
      const configPreview = await getConnectionConfigRedacted(
        providerId,
        connectionId
      );

      if (!metadata || !configPreview) return;

      return {
        id: metadata.id,
        providerId: metadata.providerId,
        name: metadata.name,
        configPreview,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      };
    },

    async getConnectionWithCredentials(connectionId) {
      let providerId = connectionProviderCache.get(connectionId);

      if (!providerId) {
        providerId = await this.findConnectionProvider(connectionId);
      }

      if (!providerId) {
        return;
      }

      const metadata = await getConnectionMetadata(providerId, connectionId);
      const config = await getConnectionConfigRaw(providerId, connectionId);

      if (!metadata || !config) return;

      return {
        id: metadata.id,
        providerId: metadata.providerId,
        name: metadata.name,
        config,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      };
    },

    async createConnection({ providerId, name, config }) {
      const now = new Date();
      const id = crypto.randomUUID();

      const metadata = {
        id,
        providerId,
        name,
        createdAt: now,
        updatedAt: now,
      };

      // Save metadata and config separately
      await setConnectionMetadata(providerId, id, metadata);
      await setConnectionConfig(providerId, id, config);

      // Add to index
      const connectionIds = await getConnectionIndex(providerId);
      connectionIds.push(id);
      await setConnectionIndex(providerId, connectionIds);

      connectionProviderCache.set(id, providerId);
      logger.info(
        `Created connection "${name}" (${id}) for provider ${providerId}`
      );

      return { ...metadata, config };
    },

    async updateConnection({ connectionId, updates }) {
      const providerId =
        connectionProviderCache.get(connectionId) ??
        (await this.findConnectionProvider(connectionId));

      if (!providerId) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      const metadata = await getConnectionMetadata(providerId, connectionId);
      const existingConfig = await getConnectionConfigRaw(
        providerId,
        connectionId
      );

      if (!metadata || !existingConfig) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      const updatedMetadata = {
        ...metadata,
        name: updates.name ?? metadata.name,
        updatedAt: new Date(),
      };

      const updatedConfig = updates.config
        ? { ...existingConfig, ...updates.config }
        : existingConfig;

      await setConnectionMetadata(providerId, connectionId, updatedMetadata);
      await setConnectionConfig(providerId, connectionId, updatedConfig);

      logger.info(
        `Updated connection "${updatedMetadata.name}" (${connectionId})`
      );
      return { ...updatedMetadata, config: updatedConfig };
    },

    async deleteConnection(connectionId) {
      const providerId =
        connectionProviderCache.get(connectionId) ??
        (await this.findConnectionProvider(connectionId));

      if (!providerId) {
        return false;
      }

      // Delete config and metadata
      await deleteConnectionData(providerId, connectionId);

      // Remove from index
      const connectionIds = await getConnectionIndex(providerId);
      const filtered = connectionIds.filter((id) => id !== connectionId);

      if (filtered.length === connectionIds.length) {
        return false;
      }

      await setConnectionIndex(providerId, filtered);
      connectionProviderCache.delete(connectionId);

      logger.info(
        `Deleted connection ${connectionId} from provider ${providerId}`
      );
      return true;
    },

    async findConnectionProvider(connectionId) {
      // Check cache first
      const cached = connectionProviderCache.get(connectionId);
      if (cached) return cached;

      // Iterate through providers that have connectionSchema
      for (const provider of providerRegistry.getProviders()) {
        if (!provider.connectionSchema) continue;

        const connectionIds = await getConnectionIndex(provider.qualifiedId);
        if (connectionIds.includes(connectionId)) {
          connectionProviderCache.set(connectionId, provider.qualifiedId);
          return provider.qualifiedId;
        }
      }

      return;
    },
  };
}
