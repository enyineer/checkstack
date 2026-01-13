import { describe, it, expect, mock } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";

describe("HealthCheck Router", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user",
    permissions: ["*"],
    roles: ["admin"],
  };

  // Create a mock database with the methods used by HealthCheckService
  const createSelectMock = () => {
    const fromResult = Object.assign(Promise.resolve([]), {
      where: mock(() => Promise.resolve([])),
    });
    return {
      from: mock(() => fromResult),
    };
  };

  const mockDb = {
    select: mock(() => createSelectMock()),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    query: {
      healthCheckConfigurations: {
        findFirst: mock(() => Promise.resolve(null)),
      },
    },
  } as unknown;

  const mockRegistry = {
    register: mock(),
    getStrategy: mock(),
    getStrategies: mock(() => []),
    getStrategiesWithMeta: mock(() => []),
  };

  const router = createHealthCheckRouter(mockDb as never, mockRegistry);

  it("getStrategies returns strategies from registry", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      healthCheckRegistry: {
        getStrategiesWithMeta: mock().mockReturnValue([
          {
            strategy: {
              id: "http",
              displayName: "HTTP",
              description: "Check HTTP",
              config: {
                version: 1,
                schema: z.object({}),
              },
              aggregatedResult: {
                schema: z.object({}),
              },
            },
            qualifiedId: "healthcheck-http.http",
            ownerPluginId: "healthcheck-http",
          },
        ]),
        getStrategies: mock().mockReturnValue([]),
      } as never,
    });

    const result = await call(router.getStrategies, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("healthcheck-http.http");
  });

  it("getConfigurations calls service", async () => {
    const context = createMockRpcContext({
      user: mockUser,
    });

    const result = await call(router.getConfigurations, undefined, { context });
    expect(result).toHaveProperty("configurations");
    expect(Array.isArray(result.configurations)).toBe(true);
  });

  it("getCollectors returns collectors for strategy", async () => {
    const mockCollector = {
      collector: {
        id: "cpu",
        displayName: "CPU Metrics",
        description: "Collect CPU stats",
        supportedPlugins: [{ pluginId: "healthcheck-ssh" }],
        allowMultiple: false,
        config: { version: 1, schema: z.object({}) },
        result: { version: 1, schema: z.object({}) },
        aggregatedResult: { version: 1, schema: z.object({}) },
      },
      ownerPlugin: { pluginId: "collector-hardware" },
    };

    const context = createMockRpcContext({
      user: mockUser,
      healthCheckRegistry: {
        getStrategy: mock().mockReturnValue({ id: "healthcheck-ssh" }),
        getStrategies: mock().mockReturnValue([]),
      } as never,
      collectorRegistry: {
        getCollectorsForPlugin: mock().mockReturnValue([mockCollector]),
        getCollector: mock(),
        getCollectors: mock().mockReturnValue([]),
        register: mock(),
      } as never,
    });

    const result = await call(
      router.getCollectors,
      { strategyId: "healthcheck-ssh" },
      { context }
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("collector-hardware.cpu");
    expect(result[0].displayName).toBe("CPU Metrics");
    expect(result[0].allowMultiple).toBe(false);
  });

  it("getCollectors returns empty for unknown strategy", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      healthCheckRegistry: {
        getStrategy: mock().mockReturnValue(undefined),
        getStrategies: mock().mockReturnValue([]),
      } as never,
    });

    const result = await call(
      router.getCollectors,
      { strategyId: "unknown" },
      { context }
    );
    expect(result).toHaveLength(0);
  });
});
