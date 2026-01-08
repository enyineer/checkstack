import { describe, it, expect, mock, beforeAll, beforeEach } from "bun:test";
import {
  coreServices,
  createBackendPlugin,
  HealthCheckStrategy,
  Versioned,
} from "@checkmate-monitor/backend-api";
import { z } from "zod";
import { createMockDbModule } from "@checkmate-monitor/test-utils-backend";
import { createMockLoggerModule } from "@checkmate-monitor/test-utils-backend";

// Mock DB and other globals to avoid side effects BEFORE importing PluginManager
mock.module("./db", () => createMockDbModule());
mock.module("./logger", () => createMockLoggerModule());

// Use dynamic import to ensure mocks are applied first
// Static imports are hoisted above mock.module() calls, causing TDZ errors in CI
let PluginManager: typeof import("./plugin-manager").PluginManager;

beforeAll(async () => {
  const mod = await import("./plugin-manager");
  PluginManager = mod.PluginManager;
});

describe("HealthCheck Plugin Integration", () => {
  let pluginManager: InstanceType<typeof PluginManager>;

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
    pluginManager.registerService(coreServices.queueManager, {
      getQueue: mock(),
      getActivePlugin: () => "mock",
      setActiveBackend: mock(),
      getQueueStatus: mock(),
      startPolling: mock(),
      stopPolling: mock(),
    } as never);

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
