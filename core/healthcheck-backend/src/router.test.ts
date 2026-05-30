import { describe, it, expect, mock } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";
import type { HealthCheckCache } from "./cache";

const passthroughCache: HealthCheckCache = {
  wrapSystemHealthStatus: (_systemId, loader) => loader(),
  invalidateSystem: async () => {},
  invalidateAllSystems: async () => 0,
  scope: {} as HealthCheckCache["scope"],
};

describe("HealthCheck Router", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user",
    accessRules: ["*"],
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

  const mockCollectorRegistry = {
    register: mock(),
    getCollector: mock(),
    getCollectors: mock(() => []),
    getCollectorsForPlugin: mock(() => []),
  };

  const mockGitOpsClient = {
    getProvenance: mock<any>(() => Promise.resolve(null)),
  };

  const mockConfigService = {
    get: mock(async () => undefined),
    set: mock(async () => {}),
    getRedacted: mock(async () => undefined),
  };

  const mockCatalogClient = {
    getSystem: mock(async () => null),
  };

  const mockMaintenanceClient = {
    hasActiveMaintenance: mock(async () => ({ active: false })),
  };

  const mockLogger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const router = createHealthCheckRouter({
    database: mockDb as never,
    registry: mockRegistry,
    collectorRegistry: mockCollectorRegistry as never,
    gitOpsClient: mockGitOpsClient as never,
    getEmitHook: () => undefined,
    cache: passthroughCache,
    configService: mockConfigService as never,
    catalogClient: mockCatalogClient as never,
    maintenanceClient: mockMaintenanceClient as never,
    logger: mockLogger as never,
  });

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
              category: "networking",
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

  it("getConfiguration returns undefined for non-existent config", async () => {
    const context = createMockRpcContext({
      user: mockUser,
    });

    const result = await call(
      router.getConfiguration,
      { id: "non-existent" },
      { context },
    );
    expect(result).toBeUndefined();
  });

  it("getCollectors returns collectors for strategy", async () => {
    const mockCollector = {
      qualifiedId: "collector-hardware.cpu",
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
      { context },
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
      { context },
    );
    expect(result).toHaveLength(0);
  });

  describe("GitOps Provenance Enforcement", () => {
    it("allows deleteConfiguration when GitOps lock is not present", async () => {
      mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
      const context = createMockRpcContext({ user: mockUser });
      
      try {
        await call(router.deleteConfiguration, "config-1", { context });
      } catch (e: any) {
        // If it throws anything other than FORBIDDEN, it passed the lock check
        expect(e.code).not.toBe("FORBIDDEN");
      }
      
      expect(mockGitOpsClient.getProvenance).toHaveBeenCalledWith({
        kind: "Healthcheck",
        entityId: "config-1"
      });
    });

    it("throws FORBIDDEN when deleting a GitOps locked configuration", async () => {
      mockGitOpsClient.getProvenance.mockResolvedValueOnce({ 
        id: "prov-1", kind: "Healthcheck", entityId: "config-1", 
        providerId: "prov", entityName: "c1", status: "synced", 
        lastSyncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        repository: "", filePath: "", fileSha: ""
      });
      const context = createMockRpcContext({ user: mockUser });
      
      let error;
      try {
        await call(router.deleteConfiguration, "config-1", { context });
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect((error as any).code).toBe("FORBIDDEN");
      expect((error as any).message).toContain("managed by GitOps");
    });
    
    it("throws FORBIDDEN when associating a system that is GitOps locked", async () => {
      mockGitOpsClient.getProvenance.mockResolvedValueOnce({ 
        id: "prov-1", kind: "System", entityId: "sys-1", 
        providerId: "prov", entityName: "s1", status: "synced", 
        lastSyncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        repository: "", filePath: "", fileSha: ""
      });
      const context = createMockRpcContext({ user: mockUser });
      
      let error;
      try {
        await call(router.associateSystem, { systemId: "sys-1", body: { configurationId: "12345678-1234-4234-8234-123456789012", enabled: true, satelliteIds: [], includeLocal: false } }, { context });
      } catch (e: any) {
        error = e;
        if (e.code !== "FORBIDDEN") console.log(e.issues || e.message);
      }
      expect(error).toBeDefined();
      expect((error as any).code).toBe("FORBIDDEN");
    });
  });
});
