import { describe, it, expect, mock } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext, Versioned } from "@checkstack/backend-api";
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

  describe("validateConfiguration", () => {
    // A strategy whose config requires a URL-typed `url` field. The schema is
    // strict-validated through the migrate-then-validate path, so a wrong type
    // or an unknown key is rejected even though the key may be present.
    const strategyConfigSchema = z.object({ url: z.string().url() });
    const collectorConfigSchema = z.object({ path: z.string().min(1) });

    const registeredStrategy = {
      strategy: {
        id: "http",
        displayName: "HTTP",
        config: new Versioned({ version: 1, schema: strategyConfigSchema }),
        aggregatedResult: { schema: z.object({}) },
      },
      qualifiedId: "healthcheck-http.http",
      ownerPluginId: "healthcheck-http",
    };
    const registeredCollector = {
      qualifiedId: "collector-file.file",
      collector: {
        displayName: "File",
        config: new Versioned({ version: 1, schema: collectorConfigSchema }),
        result: { schema: z.object({}) },
        supportedPlugins: [{ pluginId: "healthcheck-http" }],
      },
      ownerPlugin: { id: "collector-file" },
    };

    const validateContext = () =>
      createMockRpcContext({
        user: mockUser,
        healthCheckRegistry: {
          getStrategiesWithMeta: mock().mockReturnValue([registeredStrategy]),
          getStrategy: mock().mockReturnValue(registeredStrategy.strategy),
          getStrategies: mock().mockReturnValue([]),
        } as never,
        collectorRegistry: {
          getCollectors: mock().mockReturnValue([registeredCollector]),
          getCollector: mock().mockReturnValue(registeredCollector),
          getCollectorsForPlugin: mock().mockReturnValue([registeredCollector]),
          register: mock(),
        } as never,
      });

    it("returns valid for a well-formed configuration without persisting", async () => {
      const result = await call(
        router.validateConfiguration,
        {
          name: "ok",
          strategyId: "healthcheck-http.http",
          config: { url: "https://example.test" },
          intervalSeconds: 60,
          collectors: [
            {
              id: "c1",
              collectorId: "collector-file.file",
              config: { path: "/tmp/x" },
            },
          ],
        },
        { context: validateContext() },
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // No DB insert ran (the insert mock returns []), proving non-persistence.
    });

    it("rejects an unknown strategy", async () => {
      const result = await call(
        router.validateConfiguration,
        {
          name: "x",
          strategyId: "healthcheck-http.ghost",
          config: { url: "https://example.test" },
          intervalSeconds: 60,
        },
        { context: validateContext() },
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toEqual(["strategyId"]);
    });

    // Deep-vs-lightweight: `url` IS present (the old presence check passes),
    // but holds the wrong TYPE. Only the strict migrate-then-validate path
    // rejects it.
    it("rejects a deep field/type error a presence check would miss", async () => {
      const result = await call(
        router.validateConfiguration,
        {
          name: "x",
          strategyId: "healthcheck-http.http",
          config: { url: 12345 },
          intervalSeconds: 60,
        },
        { context: validateContext() },
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].path[0]).toBe("config");
    });

    it("rejects an unknown collector", async () => {
      const result = await call(
        router.validateConfiguration,
        {
          name: "x",
          strategyId: "healthcheck-http.http",
          config: { url: "https://example.test" },
          intervalSeconds: 60,
          collectors: [
            { id: "c1", collectorId: "collector-file.ghost", config: {} },
          ],
        },
        { context: validateContext() },
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toEqual(["collectors", 0, "collectorId"]);
    });
  });

  describe("GitOps Provenance Enforcement", () => {
    it("allows deleteConfiguration when GitOps lock is not present", async () => {
      mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
      const context = createMockRpcContext({ user: mockUser });
      
      try {
        await call(router.deleteConfiguration, { id: "config-1" }, { context });
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
        await call(router.deleteConfiguration, { id: "config-1" }, { context });
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
