/**
 * Generic connection store for integration providers.
 * Stores site-wide connections using ConfigService.
 * Connections are scoped by providerId for isolation.
 *
 * Secrets are handled automatically via:
 * - Provider's connectionSchema uses secret() branded type for sensitive fields
 * - ConfigService encrypts secret() fields on write
 * - ConfigService.getRedacted() strips secret() fields for API responses
 */
import { z } from "zod";
import type { ConfigService, Logger } from "@checkmate-monitor/backend-api";
import type { IntegrationProviderRegistry } from "./provider-registry";
import type {
  ProviderConnection,
  ProviderConnectionRedacted,
} from "@checkmate-monitor/integration-common";

// Internal wrapper schema for storing multiple connections
const ConnectionListSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      name: z.string(),
      config: z.record(z.string(), z.unknown()),
      createdAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
    })
  ),
});

const CONNECTION_STORAGE_VERSION = 1;

/**
 * Configuration key for provider connections.
 */
function getConnectionKey(providerId: string): string {
  const sanitized = providerId.replaceAll(".", "_");
  return `integration_connections_${sanitized}`;
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
   * Get all connections for a provider (with full credentials).
   */
  async function getProviderConnectionsRaw(
    providerId: string
  ): Promise<ProviderConnection[]> {
    const key = getConnectionKey(providerId);
    const data = await configService.get(
      key,
      ConnectionListSchema,
      CONNECTION_STORAGE_VERSION
    );
    return data?.connections ?? [];
  }

  /**
   * Get all connections for a provider (secrets redacted via ConfigService).
   */
  async function getProviderConnectionsRedacted(
    providerId: string
  ): Promise<ProviderConnectionRedacted[]> {
    const key = getConnectionKey(providerId);
    const data = await configService.getRedacted(
      key,
      ConnectionListSchema,
      CONNECTION_STORAGE_VERSION
    );

    if (!data?.connections) return [];

    return data.connections.map((conn) => ({
      id: conn.id,
      providerId: conn.providerId,
      name: conn.name,
      configPreview: conn.config,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));
  }

  /**
   * Save connections for a provider.
   */
  async function setProviderConnections(
    providerId: string,
    connections: ProviderConnection[]
  ): Promise<void> {
    const key = getConnectionKey(providerId);
    await configService.set(
      key,
      ConnectionListSchema,
      CONNECTION_STORAGE_VERSION,
      { connections }
    );
  }

  return {
    async listConnections(providerId) {
      // Validate provider exists and has connectionSchema
      const provider = providerRegistry.getProvider(providerId);
      if (!provider?.connectionSchema) {
        return [];
      }

      const connections = await getProviderConnectionsRedacted(providerId);

      // Update cache
      for (const conn of connections) {
        connectionProviderCache.set(conn.id, providerId);
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

      const connections = await getProviderConnectionsRedacted(providerId);
      return connections.find((c) => c.id === connectionId);
    },

    async getConnectionWithCredentials(connectionId) {
      let providerId = connectionProviderCache.get(connectionId);

      if (!providerId) {
        providerId = await this.findConnectionProvider(connectionId);
      }

      if (!providerId) {
        return;
      }

      const connections = await getProviderConnectionsRaw(providerId);
      return connections.find((c) => c.id === connectionId);
    },

    async createConnection({ providerId, name, config }) {
      const now = new Date();
      const id = crypto.randomUUID();

      const connection: ProviderConnection = {
        id,
        providerId,
        name,
        config,
        createdAt: now,
        updatedAt: now,
      };

      const existing = await getProviderConnectionsRaw(providerId);
      existing.push(connection);
      await setProviderConnections(providerId, existing);

      connectionProviderCache.set(id, providerId);
      logger.info(
        `Created connection "${name}" (${id}) for provider ${providerId}`
      );

      return connection;
    },

    async updateConnection({ connectionId, updates }) {
      const providerId =
        connectionProviderCache.get(connectionId) ??
        (await this.findConnectionProvider(connectionId));

      if (!providerId) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      const connections = await getProviderConnectionsRaw(providerId);
      const index = connections.findIndex((c) => c.id === connectionId);

      if (index === -1) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      const existing = connections[index];
      const updated: ProviderConnection = {
        ...existing,
        name: updates.name ?? existing.name,
        config: updates.config
          ? { ...existing.config, ...updates.config }
          : existing.config,
        updatedAt: new Date(),
      };

      connections[index] = updated;
      await setProviderConnections(providerId, connections);

      logger.info(`Updated connection "${updated.name}" (${connectionId})`);
      return updated;
    },

    async deleteConnection(connectionId) {
      const providerId =
        connectionProviderCache.get(connectionId) ??
        (await this.findConnectionProvider(connectionId));

      if (!providerId) {
        return false;
      }

      const connections = await getProviderConnectionsRaw(providerId);
      const filtered = connections.filter((c) => c.id !== connectionId);

      if (filtered.length === connections.length) {
        return false;
      }

      await setProviderConnections(providerId, filtered);
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

        const connections = await getProviderConnectionsRaw(
          provider.qualifiedId
        );
        const found = connections.find((c) => c.id === connectionId);
        if (found) {
          connectionProviderCache.set(connectionId, provider.qualifiedId);
          return provider.qualifiedId;
        }
      }

      return;
    },
  };
}
