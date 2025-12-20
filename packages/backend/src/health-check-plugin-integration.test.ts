import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PluginManager } from "./plugin-manager";
import {
  coreServices,
  createBackendPlugin,
  HealthCheckStrategy,
} from "@checkmate/backend-api";

// Mock DB and other globals to avoid side effects
mock.module("./db", () => ({
  adminPool: { query: mock(() => Promise.resolve()) },
  db: {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    })),
  },
}));

// Note: FS mocking is no longer needed with manual injection support

mock.module("./logger", () => ({
  rootLogger: {
    info: mock(),
    debug: mock(),
    warn: mock(),
    error: mock(),
    child: mock(() => ({
      info: mock(),
      debug: mock(),
      warn: mock(),
      error: mock(),
    })),
  },
}));

describe("HealthCheck Plugin Integration", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  it("should allow a plugin to register a health check strategy", async () => {
    const mockRouter: any = { route: mock() };

    // 1. Define a mock strategy
    const testStrategy: HealthCheckStrategy<any> = {
      id: "plugin-test-strategy",
      displayName: "Plugin Test Strategy",
      description: "A strategy registered by a plugin",
      configSchema: { type: "object" } as any,
      execute: mock(async () => ({ status: "healthy" as const })),
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
            healthCheckRegistry.register(testStrategy);
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

    const strategy = registry?.getStrategy(testStrategy.id);
    expect(strategy).toBe(testStrategy);
    expect(strategy?.displayName).toBe("Plugin Test Strategy");
  });
});
