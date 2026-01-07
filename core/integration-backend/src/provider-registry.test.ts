import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  createIntegrationProviderRegistry,
  type IntegrationProviderRegistry,
} from "./provider-registry";
import type { IntegrationProvider } from "./provider-types";
import { Versioned } from "@checkmate-monitor/backend-api";

/**
 * Unit tests for IntegrationProviderRegistry.
 *
 * Tests cover:
 * - Provider registration with proper namespacing
 * - Provider retrieval by qualified ID
 * - Config schema JSON conversion
 */

// Test plugin metadata
const testPluginMetadata = {
  pluginId: "test-plugin",
  displayName: "Test Plugin",
} as const;

// Test config schemas
const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]),
  timeout: z.number().default(5000),
});

const slackConfigSchema = z.object({
  webhookUrl: z.string().url(),
  channel: z.string(),
});

// Create test providers
function createTestProvider(
  id: string,
  schema: z.ZodType<unknown>
): IntegrationProvider<unknown> {
  return {
    id,
    displayName: `${id.charAt(0).toUpperCase()}${id.slice(1)} Provider`,
    description: `Deliver events via ${id}`,
    icon: id,
    config: new Versioned({
      version: 1,
      schema,
    }),
    deliver: async () => ({ success: true }),
  };
}

describe("IntegrationProviderRegistry", () => {
  let registry: IntegrationProviderRegistry;

  beforeEach(() => {
    registry = createIntegrationProviderRegistry();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Registration
  // ─────────────────────────────────────────────────────────────────────────

  describe("register", () => {
    it("registers a provider with a fully qualified ID", () => {
      const provider = createTestProvider("webhook", webhookConfigSchema);

      registry.register(provider, testPluginMetadata);

      expect(registry.hasProvider("test-plugin.webhook")).toBe(true);
    });

    it("generates correct qualified ID", () => {
      const provider = createTestProvider("webhook", webhookConfigSchema);

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.webhook");
      expect(registered?.qualifiedId).toBe("test-plugin.webhook");
      expect(registered?.ownerPluginId).toBe("test-plugin");
    });

    it("preserves provider metadata", () => {
      const provider: IntegrationProvider<unknown> = {
        id: "custom",
        displayName: "Custom Provider",
        description: "A custom provider for testing",
        icon: "Cog",
        config: new Versioned({ version: 1, schema: webhookConfigSchema }),
        deliver: async () => ({ success: true }),
      };

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.custom");
      expect(registered?.displayName).toBe("Custom Provider");
      expect(registered?.description).toBe("A custom provider for testing");
      expect(registered?.icon).toBe("Cog");
    });

    it("preserves deliver function", () => {
      const deliverFn = async () => ({ success: true, externalId: "ext-123" });
      const provider: IntegrationProvider<unknown> = {
        id: "webhook",
        displayName: "Webhook",
        config: new Versioned({ version: 1, schema: webhookConfigSchema }),
        deliver: deliverFn,
      };

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.webhook");
      expect(registered?.deliver).toBeDefined();
    });

    it("preserves testConnection function if provided", () => {
      const provider: IntegrationProvider<unknown> = {
        id: "webhook",
        displayName: "Webhook",
        config: new Versioned({ version: 1, schema: webhookConfigSchema }),
        deliver: async () => ({ success: true }),
        testConnection: async () => ({ success: true, message: "OK" }),
      };

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.webhook");
      expect(registered?.testConnection).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Retrieval
  // ─────────────────────────────────────────────────────────────────────────

  describe("getProviders", () => {
    it("returns empty array when no providers registered", () => {
      expect(registry.getProviders()).toEqual([]);
    });

    it("returns all registered providers", () => {
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        testPluginMetadata
      );
      registry.register(
        createTestProvider("slack", slackConfigSchema),
        testPluginMetadata
      );

      const providers = registry.getProviders();
      expect(providers.length).toBe(2);
      expect(providers.map((p) => p.id).sort()).toEqual(["slack", "webhook"]);
    });
  });

  describe("getProvider", () => {
    it("returns undefined for non-existent provider", () => {
      expect(registry.getProvider("non-existent.provider")).toBeUndefined();
    });

    it("returns provider by qualified ID", () => {
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        testPluginMetadata
      );

      const provider = registry.getProvider("test-plugin.webhook");
      expect(provider?.displayName).toBe("Webhook Provider");
    });
  });

  describe("hasProvider", () => {
    it("returns false for non-existent provider", () => {
      expect(registry.hasProvider("non-existent.provider")).toBe(false);
    });

    it("returns true for registered provider", () => {
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        testPluginMetadata
      );

      expect(registry.hasProvider("test-plugin.webhook")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema
  // ─────────────────────────────────────────────────────────────────────────

  describe("getProviderConfigSchema", () => {
    it("returns undefined for non-existent provider", () => {
      expect(
        registry.getProviderConfigSchema("non-existent.provider")
      ).toBeUndefined();
    });

    it("returns JSON Schema for provider config", () => {
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        testPluginMetadata
      );

      const schema = registry.getProviderConfigSchema("test-plugin.webhook");
      expect(schema).toBeDefined();
      expect(typeof schema).toBe("object");
      expect(schema?.type).toBe("object");
    });

    it("JSON Schema includes property definitions", () => {
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        testPluginMetadata
      );

      const schema = registry.getProviderConfigSchema("test-plugin.webhook");
      const properties = schema?.properties as Record<string, unknown>;

      expect(properties).toBeDefined();
      expect(properties.url).toBeDefined();
      expect(properties.method).toBeDefined();
      expect(properties.timeout).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-Plugin Registration
  // ─────────────────────────────────────────────────────────────────────────

  describe("multi-plugin registration", () => {
    it("handles providers from multiple plugins", () => {
      const plugin1 = { pluginId: "plugin-1" } as const;
      const plugin2 = { pluginId: "plugin-2" } as const;

      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        plugin1
      );
      registry.register(
        createTestProvider("webhook", webhookConfigSchema),
        plugin2
      );

      expect(registry.hasProvider("plugin-1.webhook")).toBe(true);
      expect(registry.hasProvider("plugin-2.webhook")).toBe(true);

      const providers = registry.getProviders();
      expect(providers.length).toBe(2);
    });

    it("correctly namespaces providers by plugin", () => {
      const plugin1 = { pluginId: "integration-webhook" } as const;
      const plugin2 = { pluginId: "integration-slack" } as const;

      registry.register(
        {
          ...createTestProvider("default", webhookConfigSchema),
          displayName: "Webhook",
        },
        plugin1
      );
      registry.register(
        {
          ...createTestProvider("default", slackConfigSchema),
          displayName: "Slack",
        },
        plugin2
      );

      expect(
        registry.getProvider("integration-webhook.default")?.displayName
      ).toBe("Webhook");
      expect(
        registry.getProvider("integration-slack.default")?.displayName
      ).toBe("Slack");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Supported Events
  // ─────────────────────────────────────────────────────────────────────────

  describe("supportedEvents", () => {
    it("preserves supportedEvents array", () => {
      const provider: IntegrationProvider<unknown> = {
        id: "limited",
        displayName: "Limited Provider",
        config: new Versioned({ version: 1, schema: webhookConfigSchema }),
        supportedEvents: ["incident.created", "incident.resolved"],
        deliver: async () => ({ success: true }),
      };

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.limited");
      expect(registered?.supportedEvents).toEqual([
        "incident.created",
        "incident.resolved",
      ]);
    });

    it("handles provider with no supportedEvents (accepts all)", () => {
      const provider = createTestProvider("webhook", webhookConfigSchema);

      registry.register(provider, testPluginMetadata);

      const registered = registry.getProvider("test-plugin.webhook");
      expect(registered?.supportedEvents).toBeUndefined();
    });
  });
});
