import { describe, it, expect, beforeEach, mock } from "bun:test";
import { z } from "zod";
import {
  createConnectionStore,
  type ConnectionStore,
} from "./connection-store";
import type { ConfigService, Logger } from "@checkmate-monitor/backend-api";
import { Versioned, secret } from "@checkmate-monitor/backend-api";
import type { IntegrationProviderRegistry } from "./provider-registry";

/**
 * Unit tests for ConnectionStore.
 *
 * Tests cover:
 * - Connection CRUD operations
 * - Secret redaction via ConfigService.getRedacted
 * - Connection lookup across providers
 * - Provider cache management
 */

// Test connection config schema with secret field
const testConnectionSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: secret(z.string().min(1)),
});

// Mock logger
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
} as unknown as Logger;

// Create a mock config service
function createMockConfigService() {
  const storage = new Map<string, unknown>();

  return {
    storage,
    get: mock(async (key: string) => storage.get(key)),
    getRedacted: mock(async (key: string) => {
      const data = storage.get(key);
      if (!data) return undefined;
      // Simulate redaction: if data is an object with apiKey or token, remove it
      if (typeof data === "object" && data !== null) {
        const result = { ...data } as Record<string, unknown>;
        // Remove common secret field names for redaction simulation
        delete result.apiKey;
        delete result.token;
        return result;
      }
      return data;
    }),
    set: mock(
      async (
        key: string,
        _schema: z.ZodType<unknown>,
        _version: number,
        value: unknown
      ) => {
        storage.set(key, value);
      }
    ),
    delete: mock(async (key: string) => {
      storage.delete(key);
    }),
    list: mock(async () => [...storage.keys()]),
  } as unknown as ConfigService & { storage: Map<string, unknown> };
}

// Create a mock provider registry
function createMockProviderRegistry() {
  const providers = new Map<
    string,
    { qualifiedId: string; connectionSchema?: unknown }
  >();

  const registry = {
    getProvider: mock((qualifiedId: string) => {
      return providers.get(qualifiedId);
    }),
    getProviders: mock(() => {
      return [...providers.entries()].map(([id, p]) => ({
        qualifiedId: id,
        connectionSchema: p.connectionSchema,
      }));
    }),
    getProviderConnectionSchema: mock((qualifiedId: string) => {
      const provider = providers.get(qualifiedId);
      if (!provider?.connectionSchema) return undefined;
      return { type: "object" }; // Simplified JSON schema
    }),
  } as unknown as IntegrationProviderRegistry;

  return { registry, providers };
}

describe("ConnectionStore", () => {
  let connectionStore: ConnectionStore;
  let mockConfigService: ReturnType<typeof createMockConfigService>;
  let mockProviders: Map<
    string,
    { qualifiedId: string; connectionSchema?: unknown }
  >;

  beforeEach(() => {
    mockConfigService = createMockConfigService();
    const { registry, providers } = createMockProviderRegistry();
    mockProviders = providers;

    // Register a test provider with connection schema
    mockProviders.set("test-plugin.jira", {
      qualifiedId: "test-plugin.jira",
      connectionSchema: new Versioned({
        version: 1,
        schema: testConnectionSchema,
      }),
    });

    connectionStore = createConnectionStore({
      configService: mockConfigService,
      providerRegistry: registry,
      logger: mockLogger,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Create Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("createConnection", () => {
    it("creates a new connection with generated ID", async () => {
      const connection = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "My Jira Connection",
        config: {
          baseUrl: "https://example.atlassian.net",
          apiKey: "secret-key",
        },
      });

      expect(connection.id).toBeDefined();
      expect(connection.name).toBe("My Jira Connection");
      expect(connection.providerId).toBe("test-plugin.jira");
      expect(connection.config.baseUrl).toBe("https://example.atlassian.net");
    });

    it("stores connection in config service", async () => {
      await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Test Connection",
        config: { baseUrl: "https://test.atlassian.net", apiKey: "key123" },
      });

      expect(mockConfigService.set).toHaveBeenCalled();
    });

    it("sets createdAt and updatedAt timestamps", async () => {
      const before = new Date();
      const connection = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Timestamped Connection",
        config: { baseUrl: "https://time.atlassian.net", apiKey: "timekey" },
      });
      const after = new Date();

      expect(connection.createdAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(connection.createdAt.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
      expect(connection.updatedAt.getTime()).toBe(
        connection.createdAt.getTime()
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // List Connections
  // ─────────────────────────────────────────────────────────────────────────

  describe("listConnections", () => {
    it("returns empty array when no connections exist", async () => {
      const connections = await connectionStore.listConnections(
        "test-plugin.jira"
      );
      expect(connections).toEqual([]);
    });

    it("returns connections for a specific provider", async () => {
      await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Connection 1",
        config: { baseUrl: "https://one.atlassian.net", apiKey: "key1" },
      });
      await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Connection 2",
        config: { baseUrl: "https://two.atlassian.net", apiKey: "key2" },
      });

      const connections = await connectionStore.listConnections(
        "test-plugin.jira"
      );
      expect(connections.length).toBe(2);
      expect(connections.map((c) => c.name).sort()).toEqual([
        "Connection 1",
        "Connection 2",
      ]);
    });

    it("returns redacted connections (secrets removed)", async () => {
      await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Secret Connection",
        config: {
          baseUrl: "https://secret.atlassian.net",
          apiKey: "super-secret",
        },
      });

      const connections = await connectionStore.listConnections(
        "test-plugin.jira"
      );
      expect(connections.length).toBe(1);
      // The mock simulates redaction by only returning baseUrl
      expect(connections[0].configPreview.baseUrl).toBe(
        "https://secret.atlassian.net"
      );
      expect(connections[0].configPreview.apiKey).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Single Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("getConnection", () => {
    it("returns undefined for non-existent connection", async () => {
      const connection = await connectionStore.getConnection("non-existent-id");
      expect(connection).toBeUndefined();
    });

    it("returns redacted connection by ID", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Findable Connection",
        config: { baseUrl: "https://find.atlassian.net", apiKey: "findkey" },
      });

      const found = await connectionStore.getConnection(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Findable Connection");
      expect(found?.configPreview.apiKey).toBeUndefined(); // Redacted
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Connection With Credentials
  // ─────────────────────────────────────────────────────────────────────────

  describe("getConnectionWithCredentials", () => {
    it("returns undefined for non-existent connection", async () => {
      const connection = await connectionStore.getConnectionWithCredentials(
        "non-existent-id"
      );
      expect(connection).toBeUndefined();
    });

    it("returns full connection with credentials", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Full Credentials Connection",
        config: {
          baseUrl: "https://creds.atlassian.net",
          apiKey: "secret-api-key",
        },
      });

      const found = await connectionStore.getConnectionWithCredentials(
        created.id
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe("Full Credentials Connection");
      expect(found?.config.apiKey).toBe("secret-api-key"); // Not redacted
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Update Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("updateConnection", () => {
    it("throws error for non-existent connection", async () => {
      await expect(
        connectionStore.updateConnection({
          connectionId: "non-existent",
          updates: { name: "New Name" },
        })
      ).rejects.toThrow();
    });

    it("updates connection name", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Original Name",
        config: {
          baseUrl: "https://update.atlassian.net",
          apiKey: "updatekey",
        },
      });

      const updated = await connectionStore.updateConnection({
        connectionId: created.id,
        updates: { name: "Updated Name" },
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.config.baseUrl).toBe("https://update.atlassian.net"); // Unchanged
    });

    it("updates connection config", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Config Update Test",
        config: { baseUrl: "https://old.atlassian.net", apiKey: "oldkey" },
      });

      const updated = await connectionStore.updateConnection({
        connectionId: created.id,
        updates: {
          config: { baseUrl: "https://new.atlassian.net", apiKey: "newkey" },
        },
      });

      expect(updated.config.baseUrl).toBe("https://new.atlassian.net");
      expect(updated.config.apiKey).toBe("newkey");
    });

    it("updates updatedAt timestamp", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Timestamp Test",
        config: { baseUrl: "https://time.atlassian.net", apiKey: "timekey" },
      });

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await connectionStore.updateConnection({
        connectionId: created.id,
        updates: { name: "New Name" },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delete Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("deleteConnection", () => {
    it("returns false for non-existent connection", async () => {
      const result = await connectionStore.deleteConnection("non-existent");
      expect(result).toBe(false);
    });

    it("deletes existing connection", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "To Be Deleted",
        config: {
          baseUrl: "https://delete.atlassian.net",
          apiKey: "deletekey",
        },
      });

      const deleted = await connectionStore.deleteConnection(created.id);
      expect(deleted).toBe(true);

      const found = await connectionStore.getConnection(created.id);
      expect(found).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Find Connection Provider
  // ─────────────────────────────────────────────────────────────────────────

  describe("findConnectionProvider", () => {
    it("returns undefined for non-existent connection", async () => {
      const providerId = await connectionStore.findConnectionProvider(
        "non-existent"
      );
      expect(providerId).toBeUndefined();
    });

    it("returns provider ID for existing connection", async () => {
      const created = await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Provider Lookup Test",
        config: {
          baseUrl: "https://lookup.atlassian.net",
          apiKey: "lookupkey",
        },
      });

      const providerId = await connectionStore.findConnectionProvider(
        created.id
      );
      expect(providerId).toBe("test-plugin.jira");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple Providers
  // ─────────────────────────────────────────────────────────────────────────

  describe("multiple providers", () => {
    beforeEach(() => {
      // Register a second provider
      mockProviders.set("test-plugin.slack", {
        qualifiedId: "test-plugin.slack",
        connectionSchema: new Versioned({
          version: 1,
          schema: z.object({
            webhookUrl: z.string().url(),
            token: secret(z.string()),
          }),
        }),
      });
    });

    it("isolates connections by provider", async () => {
      await connectionStore.createConnection({
        providerId: "test-plugin.jira",
        name: "Jira Connection",
        config: { baseUrl: "https://jira.atlassian.net", apiKey: "jirakey" },
      });
      await connectionStore.createConnection({
        providerId: "test-plugin.slack",
        name: "Slack Connection",
        config: {
          webhookUrl: "https://hooks.slack.com/abc",
          token: "slack-token",
        },
      });

      const jiraConnections = await connectionStore.listConnections(
        "test-plugin.jira"
      );
      const slackConnections = await connectionStore.listConnections(
        "test-plugin.slack"
      );

      expect(jiraConnections.length).toBe(1);
      expect(slackConnections.length).toBe(1);
      expect(jiraConnections[0].name).toBe("Jira Connection");
      expect(slackConnections[0].name).toBe("Slack Connection");
    });
  });
});
