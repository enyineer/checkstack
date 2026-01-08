import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  coreServices,
  createBackendPlugin,
  HealthCheckStrategy,
  Versioned,
} from "@checkmate-monitor/backend-api";
import { createMockQueueManager } from "@checkmate-monitor/test-utils-backend";
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

    // Define a mock execute function for the strategy
    const mockExecute = mock(async () => ({ status: "healthy" as const }));

    // 1. Define a mock strategy
    const mockStrategy: HealthCheckStrategy = {
      id: "test-strategy",
      displayName: "Test Strategy",
      description: "A test strategy for integration testing",
      config: new Versioned({
        version: 1,
        schema: z.object({}),
      }),
      aggregatedResult: new Versioned({
        version: 1,
        schema: z.record(z.string(), z.unknown()),
      }),
      execute: mockExecute,
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

    // Register mock queueManager since EventBus depends on it
    pluginManager.registerService(
      coreServices.queueManager,
      createMockQueueManager()
    );

    // 4. Load plugins using the PluginManager with manual injection
    await pluginManager.loadPlugins(mockRouter, [testPlugin], {
      skipDiscovery: true,
    });

    // 5. Verify the strategy is registered in the registry managed by PluginManager
    const registry = await pluginManager.getService(
      coreServices.healthCheckRegistry
    );
    expect(registry).toBeDefined();

    const retrieved = registry?.getStrategy(mockStrategy.id);
    expect(retrieved).toBe(mockStrategy);
    expect(retrieved?.displayName).toBe("Test Strategy");
    expect(retrieved?.id).toBe("test-strategy");
    expect(retrieved?.execute).toBe(mockExecute);
  });
});
