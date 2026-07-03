/**
 * Provider registry behaviour tests — scoped to connection-management
 * after the Automation Platform migration. Subscription / delivery
 * concerns moved to the trigger / action registries on the automation
 * side; the integration registry now only owns connection schemas.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { z } from "zod";
import { Versioned, configSecret } from "@checkstack/backend-api";
import {
  createIntegrationProviderRegistry,
  type IntegrationProviderRegistry,
} from "./provider-registry";
import type { IntegrationProvider } from "./provider-types";

const testPlugin = { pluginId: "test-plugin" } as const;

const sampleConnectionSchema = z.object({
  apiKey: configSecret({ id: "apiKey" }).describe("API key"),
});

type SampleConnection = z.infer<typeof sampleConnectionSchema>;

const sampleProvider: IntegrationProvider<SampleConnection> = {
  id: "sample",
  displayName: "Sample",
  description: "Sample provider for tests",
  icon: "Webhook",
  connectionSchema: new Versioned({
    version: 1,
    schema: sampleConnectionSchema,
  }),
};

describe("IntegrationProviderRegistry", () => {
  let registry: IntegrationProviderRegistry;
  beforeEach(() => {
    registry = createIntegrationProviderRegistry();
  });

  it("namespaces ids by plugin", () => {
    registry.register(sampleProvider, testPlugin);
    const registered = registry.getProvider("test-plugin.sample");
    expect(registered).toBeDefined();
    expect(registered?.qualifiedId).toBe("test-plugin.sample");
    expect(registered?.ownerPluginId).toBe("test-plugin");
  });

  it("returns all registered providers", () => {
    registry.register(sampleProvider, testPlugin);
    registry.register(
      { ...sampleProvider, id: "other" } as IntegrationProvider<SampleConnection>,
      testPlugin,
    );
    expect(registry.getProviders()).toHaveLength(2);
  });

  it("reports presence via hasProvider", () => {
    registry.register(sampleProvider, testPlugin);
    expect(registry.hasProvider("test-plugin.sample")).toBe(true);
    expect(registry.hasProvider("test-plugin.missing")).toBe(false);
  });

  it("exposes the connection JSON schema when present", () => {
    registry.register(sampleProvider, testPlugin);
    const schema = registry.getProviderConnectionSchema("test-plugin.sample");
    expect(schema).toBeDefined();
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  it("returns undefined for providers without a connection schema", () => {
    const minimal: IntegrationProvider<undefined> = {
      id: "minimal",
      displayName: "Minimal",
    };
    registry.register(
      minimal as IntegrationProvider<unknown>,
      testPlugin,
    );
    expect(
      registry.getProviderConnectionSchema("test-plugin.minimal"),
    ).toBeUndefined();
  });
});
