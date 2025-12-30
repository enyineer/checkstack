import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PluginManager } from "./plugin-manager";
import {
  coreServices,
  createBackendPlugin,
  HealthCheckStrategy,
} from "@checkmate/backend-api";
import { z } from "zod";
import { createMockDbModule } from "@checkmate/test-utils-backend";
import { createMockLoggerModule } from "@checkmate/test-utils-backend";

// Mock DB and other globals to avoid side effects
mock.module("./db", () => createMockDbModule());

// Note: FS mocking is no longer needed with manual injection support

mock.module("./logger", () => createMockLoggerModule());

describe("HealthCheck Plugin Integration", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  it("should allow a plugin to register a health check strategy", async () => {
    const mockRouter: any = {
      route: mock(),
      all: mock(),
      newResponse: mock(),
    };

    // Define a mock execute function for the strategy
    const mockExecute = mock(async () => ({ status: "healthy" as const }));

    // 1. Define a mock strategy
    const mockStrategy: HealthCheckStrategy<unknown> = {
      id: "test-strategy",
      displayName: "Test Strategy",
      description: "A test strategy for integration testing",
      configVersion: 1,
      configSchema: z.any(),
      execute: mockExecute,
    };

    // 2. Define a mock plugin that registers this strategy
    const testPlugin = createBackendPlugin({
      pluginId: "test-plugin",
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

    // 4. Load plugins using the PluginManager with manual injection
    await pluginManager.loadPlugins(mockRouter, [testPlugin]);

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
