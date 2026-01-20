import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  coreServices,
  createBackendPlugin,
  HealthCheckStrategy,
  Versioned,
} from "@checkstack/backend-api";
import {
  createMockQueueManager,
  createMockLogger,
  createMockDb,
} from "@checkstack/test-utils-backend";
import { z } from "zod";

// Note: ./db and ./logger are mocked via test-preload.ts (bunfig.toml preload)
// This ensures mocks are in place BEFORE any module imports them

import { PluginManager } from "./plugin-manager";

describe("HealthCheck Plugin Integration", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  it("should allow a plugin to register a health check strategy", async () => {
    const mockRouter = {
      route: mock(),
      all: mock(),
      newResponse: mock(),
    } as never;

    // Define a mock createClient function for the strategy
    const mockCreateClient = mock(async () => ({
      client: { exec: async () => ({}) },
      close: () => {},
    }));

    // 1. Define a mock strategy with createClient pattern
    const mockStrategy: HealthCheckStrategy = {
      id: "test-strategy",
      displayName: "Test Strategy",
      description: "A test strategy for integration testing",
      config: new Versioned({
        version: 1,
        schema: z.object({}),
      }),
      result: new Versioned({
        version: 1,
        schema: z.record(z.string(), z.unknown()),
      }),
      aggregatedResult: new Versioned({
        version: 1,
        schema: z.record(z.string(), z.unknown()),
      }),
      createClient: mockCreateClient,
      aggregateResult: mock(() => ({})),
    };

    // 2. Define a mock plugin that registers this strategy
    const testPlugin = createBackendPlugin({
      metadata: { pluginId: "test-plugin" },
      register(env) {
        env.registerInit({
          deps: {
            healthCheckRegistry: coreServices.healthCheckRegistry,
          },
          init: async ({ healthCheckRegistry }) => {
            healthCheckRegistry.register(mockStrategy);
          },
        });
      },
    });

    // Register mock services since core-services is mocked as no-op
    pluginManager.registerService(
      coreServices.queueManager,
      createMockQueueManager(),
    );
    pluginManager.registerService(coreServices.logger, createMockLogger());
    pluginManager.registerService(
      coreServices.database,
      createMockDb() as never,
    );

    // 4. Load plugins using the PluginManager with manual injection
    await pluginManager.loadPlugins(mockRouter, [testPlugin], {
      skipDiscovery: true,
    });

    // 5. Verify the strategy is registered in the registry managed by PluginManager
    const registry = await pluginManager.getService(
      coreServices.healthCheckRegistry,
    );
    expect(registry).toBeDefined();

    const retrieved = registry?.getStrategy(mockStrategy.id);
    expect(retrieved).toBe(mockStrategy);
    expect(retrieved?.displayName).toBe("Test Strategy");
    expect(retrieved?.id).toBe("test-strategy");
    expect(retrieved?.createClient).toBe(mockCreateClient);
  });
});
