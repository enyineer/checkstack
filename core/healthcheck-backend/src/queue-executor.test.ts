import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupHealthCheckWorker,
  scheduleHealthCheck,
  bootstrapHealthChecks,
  recomputeSystemRollupHealth,
  type HealthCheckJobPayload,
} from "./queue-executor";
import type { HealthCheckCache } from "./cache";

const passthroughCache: HealthCheckCache = {
  wrapSystemHealthStatus: (_systemId, loader) => loader(),
  invalidateSystem: async () => {},
  invalidateAllSystems: async () => 0,
  scope: {} as HealthCheckCache["scope"],
};

// Pass-through advisory lock: these tests don't exercise cross-pod
// serialization, so run the critical section directly.
const mockAdvisoryLock: Parameters<
  typeof setupHealthCheckWorker
>[0]["advisoryLock"] = {
  tryAcquire: async () => ({ release: async () => {} }),
  withXactLock: <T>({ fn }: { key: string; fn: () => Promise<T> }): Promise<T> =>
    fn(),
};
import {
  createMockLogger,
  createMockQueueManager,
  createMockDb,
  createMockSignalService,
} from "@checkstack/test-utils-backend";
import {
  type HealthCheckRegistry,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
  configString,
  z,
} from "@checkstack/backend-api";
import { mock } from "bun:test";

// Helper to create mock health check registry with createClient pattern
const createMockRegistry = (): HealthCheckRegistry => ({
  getStrategy: mock((id: string) => ({
    id,
    displayName: "Mock Strategy",
    description: "Mock",
    config: new Versioned({
      version: 1,
      schema: z.object({ timeout: z.number().default(30_000) }),
    }),
    result: new Versioned({
      version: 1,
      schema: z.object({}),
    }),
    aggregatedResult: new VersionedAggregated({
      version: 1,
      fields: { count: aggregatedCounter({}) },
    }),
    createClient: mock(async () => ({
      client: {
        exec: mock(async () => ({})),
      },
      close: mock(() => {}),
    })),
    mergeResult: mock(() => ({})),
  })),
  register: mock(() => {}),
  getStrategies: mock(() => []),
  getStrategiesWithMeta: mock(() => []),
});

// Helper to create mock collector registry
const createMockCollectorRegistry = () => ({
  register: mock(() => {}),
  getCollector: mock(() => undefined),
  getCollectors: mock(() => []),
});

// Helper to create mock catalog client for notification delegation
const createMockCatalogClient = () => ({
  notifySystemSubscribers: mock(async () => ({ notifiedCount: 0 })),
  // Other methods not used in queue-executor
  getEntities: mock(async () => ({ systems: [], groups: [] })),
  getSystems: mock(async () => ({ systems: [] })),
  getSystem: mock(async () => null),
  getGroups: mock(async () => []),
  createSystem: mock(async () => ({})),
  updateSystem: mock(async () => ({})),
  deleteSystem: mock(async () => ({ success: true })),
  createGroup: mock(async () => ({})),
  updateGroup: mock(async () => ({})),
  deleteGroup: mock(async () => ({ success: true })),
  addSystemToGroup: mock(async () => ({ success: true })),
  removeSystemFromGroup: mock(async () => ({ success: true })),
  getViews: mock(async () => []),
  createView: mock(async () => ({})),
});

// Helper to create mock maintenance client for notification suppression checks
const createMockMaintenanceClient = () => ({
  hasActiveMaintenanceWithSuppression: mock(async () => ({
    suppressed: false,
  })),
  // Other methods not used in queue-executor
  listMaintenances: mock(async () => ({ maintenances: [] })),
  getMaintenance: mock(async () => null),
  getMaintenancesForSystem: mock(async () => []),
  getBulkMaintenancesForSystems: mock(async () => ({ maintenances: {} })),
  createMaintenance: mock(async () => ({})),
  updateMaintenance: mock(async () => ({})),
  addUpdate: mock(async () => ({})),
  closeMaintenance: mock(async () => ({})),
  deleteMaintenance: mock(async () => ({ success: true })),
});

// Helper to create mock incident client for notification suppression checks
const createMockIncidentClient = () => ({
  hasActiveIncidentWithSuppression: mock(async () => ({
    suppressed: false,
  })),
  // Other methods not used in queue-executor
  listIncidents: mock(async () => ({ incidents: [] })),
  getIncident: mock(async () => null),
  getIncidentsForSystem: mock(async () => []),
  getBulkIncidentsForSystems: mock(async () => ({ incidents: {} })),
  createIncident: mock(async () => ({})),
  updateIncident: mock(async () => ({})),
  addUpdate: mock(async () => ({})),
  resolveIncident: mock(async () => ({})),
  deleteIncident: mock(async () => ({ success: true })),
});

describe("Queue-Based Health Check Executor", () => {
  describe("scheduleHealthCheck", () => {
    it("should enqueue a health check with delay and deterministic jobId", async () => {
      const mockQueueManager = createMockQueueManager();
      const mockLogger = createMockLogger();

      const payload: HealthCheckJobPayload = {
        configId: "config-1",
        systemId: "system-1",
      };

      await scheduleHealthCheck({
        queueManager: mockQueueManager,
        payload,
        intervalSeconds: 60,
        logger: mockLogger,
      });

      // Verify queue was created with correct name
      const queue = mockQueueManager.getQueue("health-checks");
      expect(queue).toBeDefined();
    });

    it("should use deterministic job IDs", async () => {
      const mockQueueManager = createMockQueueManager();
      const mockLogger = createMockLogger();

      const payload: HealthCheckJobPayload = {
        configId: "config-1",
        systemId: "system-1",
      };

      const result = await scheduleHealthCheck({
        queueManager: mockQueueManager,
        payload,
        intervalSeconds: 60,
        logger: mockLogger,
      });

      // The result should be a job ID
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });
  });

  describe("setupHealthCheckWorker", () => {
    it("should subscribe to the health-checks queue in work-queue mode", async () => {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry:
          createMockCollectorRegistry() as unknown as Parameters<
            typeof setupHealthCheckWorker
          >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: createMockSignalService(),
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: { notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }) } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Health Check Worker subscribed"),
      );
    });
  });

  describe("bootstrapHealthChecks", () => {
    beforeEach(() => {
      // Reset all mocks between tests
    });

    it("should enqueue all enabled health checks", async () => {
      const mockQueueManager = createMockQueueManager();
      const mockLogger = createMockLogger();
      const mockDb = createMockDb();

      // Configure the mock database to return some enabled checks
      const mockData = [
        {
          systemId: "system-1",
          configId: "config-1",
          interval: 30,
          lastRun: null,
        },
        {
          systemId: "system-2",
          configId: "config-2",
          interval: 60,
          lastRun: null,
        },
      ];

      // Override select to return a chain that handles subquery with groupBy
      // First call: for enabledChecks query (innerJoin().where)
      // Second call: for latestRuns query (groupBy)
      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // enabledChecks query
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() => Promise.resolve(mockData)),
              })),
            })),
          };
        } else {
          // latestRuns query
          return {
            from: mock(() => ({
              groupBy: mock(() => Promise.resolve([])),
            })),
          };
        }
      });

      await bootstrapHealthChecks({
        db: mockDb as any,
        queueManager: mockQueueManager,
        logger: mockLogger,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Bootstrapping 2 health checks",
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "✅ Bootstrapped 2 health checks",
      );
    });

    it("should handle empty health check list", async () => {
      const mockQueueManager = createMockQueueManager();
      const mockLogger = createMockLogger();
      const mockDb = createMockDb();

      // Override to return empty array
      const mockSelectChain = mockDb.select();
      const mockFromResult = (mockSelectChain as any).from();
      Object.assign(mockFromResult, {
        then: (resolve: any) => resolve([]),
      });

      await bootstrapHealthChecks({
        db: mockDb as any,
        queueManager: mockQueueManager,
        logger: mockLogger,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Bootstrapping 0 health checks",
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "✅ Bootstrapped 0 health checks",
      );
    });
  });

  describe("executeHealthCheckJob - paused behavior", () => {
    it("should skip execution when configuration is paused", async () => {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      // Mock the database to return a paused configuration
      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First call: get previous system health status
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() => Promise.resolve([])),
              })),
            })),
          };
        } else if (selectCallCount === 2) {
          // Second call: fetch configuration (return paused config)
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: "Test Check",
                      strategyId: "test-strategy",
                      config: {},
                      collectors: [],
                      interval: 30,
                      enabled: true,
                      paused: true, // Configuration is paused
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        // Default
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      // Setup worker and get handler
      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry:
          createMockCollectorRegistry() as unknown as Parameters<
            typeof setupHealthCheckWorker
          >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: { notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }) } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      // Execute a paused health check
      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        });
      }

      // Verify execution was skipped with appropriate log
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("is paused, skipping execution"),
      );

      // Verify no signal was broadcast (since execution was skipped)
      expect(mockSignalService.getRecordedSignals()).toHaveLength(0);
    });
  });

  describe("executeHealthCheckJob - collector run-context", () => {
    it("passes curated run-context to the collector (name falls back to id when configName is null)", async () => {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      // Catalog resolves the system name.
      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
      }));

      // configName is null -> run-context check.name must fall back to id.
      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 2) {
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: null,
                      strategyId: "test-strategy",
                      config: { timeout: 5000 },
                      collectors: [
                        { id: "col-1", collectorId: "test-collector", config: {} },
                      ],
                      interval: 45,
                      enabled: true,
                      paused: false,
                      includeLocal: true,
                      satelliteIds: [],
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      // Capture the run-context the collector receives.
      let capturedRunContext: unknown;
      const collectorExecute = mock(
        async (params: { runContext?: unknown }) => {
          capturedRunContext = params.runContext;
          return { result: {} };
        },
      );
      const mockCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => ({
          collector: {
            id: "test-collector",
            execute: collectorExecute,
            config: new Versioned({ version: 1, schema: z.object({}) }),
            mergeResult: mock(() => ({})),
          },
        })),
        getCollectors: mock(() => []),
      };

      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry: mockCollectorRegistry as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: {
          notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }),
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      if (capturedHandler) {
        // The collector runs early in the execution sequence; downstream
        // aggregation/persistence touches DB surfaces the lightweight mock
        // doesn't model, so tolerate a later throw — the run-context we
        // assert on is captured synchronously at collector-execute time.
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        }).catch(() => {});
      }

      expect(collectorExecute).toHaveBeenCalled();
      expect(capturedRunContext).toEqual({
        check: { id: "config-1", name: "config-1", intervalSeconds: 45 },
        system: { id: "system-1", name: "web-01" },
      });
    });

    it("migrates a stored v1 strategy + collector config on the execution path", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      // A strategy whose config migrates v1 -> v2 by STRIPPING a moved field
      // (`endpoint`), mirroring the real health-check reshapers. The stored
      // config is genuinely v1 (carries `endpoint`); the executor must run the
      // migration before handing the config to createClient.
      let capturedStrategyConfig: unknown;
      const strategyMigratingRegistry: HealthCheckRegistry = {
        getStrategy: mock(() => ({
          id: "migrating-strategy",
          displayName: "Migrating",
          config: new Versioned({
            version: 2,
            schema: z.object({ timeout: z.number() }),
            migrations: [
              {
                fromVersion: 1,
                toVersion: 2,
                description: "strip endpoint",
                migrate: (data: unknown): unknown => {
                  if (
                    typeof data === "object" &&
                    data !== null &&
                    "endpoint" in data
                  ) {
                    const timeout = (data as { timeout?: unknown }).timeout;
                    return { timeout: typeof timeout === "number" ? timeout : 0 };
                  }
                  return data;
                },
              },
            ],
          }),
          result: new Versioned({ version: 1, schema: z.object({}) }),
          aggregatedResult: new VersionedAggregated({
            version: 1,
            fields: { count: aggregatedCounter({}) },
          }),
          createClient: mock(async (config: unknown) => {
            capturedStrategyConfig = config;
            return {
              client: { exec: mock(async () => ({})) },
              close: mock(() => {}),
            };
          }),
          mergeResult: mock(() => ({})),
        })),
        register: mock(() => {}),
        getStrategies: mock(() => []),
        getStrategiesWithMeta: mock(() => []),
      };

      // A collector whose config migrates v1 -> v2 by renaming `cmd` -> `value`.
      let capturedCollectorConfig: unknown;
      const collectorExecute = mock(async (params: { config?: unknown }) => {
        capturedCollectorConfig = params.config;
        return { result: {} };
      });
      const migratingCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => ({
          collector: {
            id: "migrating-collector",
            execute: collectorExecute,
            config: new Versioned({
              version: 2,
              schema: z.object({ value: z.string() }),
              migrations: [
                {
                  fromVersion: 1,
                  toVersion: 2,
                  description: "rename cmd -> value",
                  migrate: (data: unknown): unknown => {
                    if (
                      typeof data === "object" &&
                      data !== null &&
                      "cmd" in data &&
                      !("value" in data)
                    ) {
                      const cmd = (data as { cmd?: unknown }).cmd;
                      return { value: typeof cmd === "string" ? cmd : "" };
                    }
                    return data;
                  },
                },
              ],
            }),
            result: new Versioned({ version: 1, schema: z.object({}) }),
            mergeResult: mock(() => ({})),
          },
        })),
        getCollectors: mock(() => []),
      };

      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 2) {
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: "v1 config",
                      strategyId: "migrating-strategy",
                      // Stored RAW + genuinely v1 (carries the moved field).
                      config: { endpoint: "tcp://old", timeout: 1234 },
                      collectors: [
                        {
                          id: "col-1",
                          collectorId: "migrating-collector",
                          config: { cmd: "legacy-value" },
                        },
                      ],
                      interval: 30,
                      enabled: true,
                      paused: false,
                      includeLocal: true,
                      satelliteIds: [],
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: strategyMigratingRegistry,
        collectorRegistry: migratingCollectorRegistry as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: {
          notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }),
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        }).catch(() => {});
      }

      // Strategy config reached createClient MIGRATED (endpoint stripped,
      // timeout preserved) and VALIDATED against the v2 schema.
      expect(capturedStrategyConfig).toEqual({ timeout: 1234 });
      // Collector config reached execute MIGRATED (cmd renamed to value).
      expect(collectorExecute).toHaveBeenCalled();
      expect(capturedCollectorConfig).toEqual({ value: "legacy-value" });
    });
  });

  describe("executeHealthCheckJob - per-environment fan-out", () => {
    /**
     * Drive one job with a configurable assignment `environmentIds` + catalog
     * membership, capturing the run-context handed to the collector on EACH
     * run. The collector executes once per fanned-out run, so the captured
     * list is a faithful witness of "one run per effective environment".
     */
    async function runFanOut({
      environmentIds,
      membership,
      collectorConfig = {},
      collectorConfigSchema = z.object({}),
    }: {
      environmentIds: string[] | null;
      membership: Array<{
        id: string;
        name: string;
        metadata: Record<string, unknown> | null;
      }>;
      /** Stored (pre-render) collector config for the single collector. */
      collectorConfig?: Record<string, unknown>;
      /** Schema used to detect `x-templatable` fields for the render pass. */
      collectorConfigSchema?: z.ZodType<unknown>;
    }): Promise<Array<{ environment?: unknown; config?: unknown }>> {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
      }));
      (mockCatalogClient as any).resolveSystemEnvironments = mock(async () =>
        membership.map((m) => ({
          ...m,
          description: null,
          systemIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );

      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 2) {
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: "Check",
                      strategyId: "test-strategy",
                      config: { timeout: 5000 },
                      collectors: [
                        {
                          id: "col-1",
                          collectorId: "test-collector",
                          config: collectorConfig,
                        },
                      ],
                      interval: 45,
                      enabled: true,
                      paused: false,
                      includeLocal: true,
                      satelliteIds: [],
                      environmentIds,
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      const captured: Array<{ environment?: unknown; config?: unknown }> = [];
      const collectorExecute = mock(
        async (params: {
          runContext?: { environment?: unknown };
          config?: unknown;
        }) => {
          captured.push({
            environment: params.runContext?.environment,
            config: params.config,
          });
          return { result: {} };
        },
      );
      const mockCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => ({
          collector: {
            id: "test-collector",
            execute: collectorExecute,
            config: new Versioned({
              version: 1,
              schema: collectorConfigSchema,
            }),
            mergeResult: mock(() => ({})),
          },
        })),
        getCollectors: mock(() => []),
      };

      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry: mockCollectorRegistry as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: {
          notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }),
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      if (capturedHandler) {
        // Downstream persistence touches DB surfaces the lightweight mock
        // doesn't fully model; tolerate a later throw — run-contexts are
        // captured synchronously at collector-execute time, one per run.
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        }).catch(() => {});
      }

      return captured;
    }

    it("runs once per effective environment with that env in run-context (null selector = all)", async () => {
      const captured = await runFanOut({
        environmentIds: null,
        membership: [
          { id: "prod", name: "Production", metadata: { baseUrl: "p" } },
          { id: "staging", name: "Staging", metadata: { baseUrl: "s" } },
        ],
      });

      expect(captured).toHaveLength(2);
      expect(captured[0]?.environment).toEqual({
        id: "prod",
        name: "Production",
        fields: { baseUrl: "p" },
      });
      expect(captured[1]?.environment).toEqual({
        id: "staging",
        name: "Staging",
        fields: { baseUrl: "s" },
      });
    });

    it("renders x-templatable config fields per environment against environment.*", async () => {
      const captured = await runFanOut({
        environmentIds: null,
        membership: [
          {
            id: "prod",
            name: "Production",
            metadata: { baseUrl: "https://prod.example.com" },
          },
          {
            id: "staging",
            name: "Staging",
            metadata: { baseUrl: "https://staging.example.com" },
          },
        ],
        collectorConfig: { url: "{{ environment.baseUrl }}/healthz" },
        collectorConfigSchema: z.object({
          url: configString({ "x-templatable": true }),
        }),
      });

      expect(captured).toHaveLength(2);
      // Each env gets its own rendered config (per-env render pass, §6.3.3).
      expect((captured[0]?.config as { url: string }).url).toBe(
        "https://prod.example.com/healthz",
      );
      expect((captured[1]?.config as { url: string }).url).toBe(
        "https://staging.example.com/healthz",
      );
    });

    it("renders environment.* to empty string for an env-less run (render-empty, §11.6)", async () => {
      const captured = await runFanOut({
        environmentIds: [],
        membership: [
          { id: "prod", name: "Production", metadata: { baseUrl: "x" } },
        ],
        collectorConfig: { url: "{{ environment.baseUrl }}/healthz" },
        collectorConfigSchema: z.object({
          url: configString({ "x-templatable": true }),
        }),
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toBeUndefined();
      // Missing path renders empty (strict: false) — the HTTP collector's
      // post-render .url() check turns this into a clear config error.
      expect((captured[0]?.config as { url: string }).url).toBe("/healthz");
    });

    it("runs only the explicit subset, intersected with membership", async () => {
      const captured = await runFanOut({
        environmentIds: ["staging"],
        membership: [
          { id: "prod", name: "Production", metadata: {} },
          { id: "staging", name: "Staging", metadata: {} },
        ],
      });

      expect(captured).toHaveLength(1);
      expect((captured[0]?.environment as { id: string }).id).toBe("staging");
    });

    it("runs exactly once with no environment when opting out ([] selector)", async () => {
      const captured = await runFanOut({
        environmentIds: [],
        membership: [{ id: "prod", name: "Production", metadata: {} }],
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toBeUndefined();
    });

    it("runs exactly once env-less when the system has no environments (null selector, empty membership)", async () => {
      const captured = await runFanOut({
        environmentIds: null,
        membership: [],
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toBeUndefined();
    });

    /**
     * Per-environment ISOLATION regression (§7.2). When the FIRST
     * environment's run throws (here: its durable persist rejects, which —
     * with no health-entity handle bound — propagates out of
     * `writeHealthEntity` to the per-env catch), the loop MUST log and
     * continue so the SECOND environment still produces a run. One env's
     * failure must never abort its siblings.
     */
    it("continues to the next environment when the first environment's run throws", async () => {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
      }));
      const membership = [
        { id: "prod", name: "Production", metadata: {} },
        { id: "staging", name: "Staging", metadata: {} },
      ];
      (mockCatalogClient as any).resolveSystemEnvironments = mock(async () =>
        membership.map((m) => ({
          ...m,
          description: null,
          systemIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );

      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 2) {
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: "Check",
                      strategyId: "test-strategy",
                      config: { timeout: 5000 },
                      collectors: [
                        {
                          id: "col-1",
                          collectorId: "test-collector",
                          config: {},
                        },
                      ],
                      interval: 45,
                      enabled: true,
                      paused: false,
                      includeLocal: true,
                      satelliteIds: [],
                      environmentIds: null,
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      // The first environment's run insert REJECTS; the second succeeds.
      // With no health-entity handle bound, a failed `apply` propagates out
      // of `writeHealthEntity`, so this throw reaches the per-env catch.
      let insertCalls = 0;
      (mockDb.insert as any) = mock(() => ({
        values: mock(() => {
          insertCalls++;
          if (insertCalls === 1) {
            return Promise.reject(new Error("env-1 persist failed"));
          }
          return Promise.resolve();
        }),
      }));

      const envSeen: Array<string | undefined> = [];
      const collectorExecute = mock(
        async (params: { runContext?: { environment?: { id?: string } } }) => {
          envSeen.push(params.runContext?.environment?.id);
          return { result: {} };
        },
      );
      const mockCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => ({
          collector: {
            id: "test-collector",
            execute: collectorExecute,
            config: new Versioned({ version: 1, schema: z.object({}) }),
            mergeResult: mock(() => ({})),
          },
        })),
        getCollectors: mock(() => []),
      };

      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry: mockCollectorRegistry as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: {
          notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }),
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        });
      }

      // BOTH environments' collectors ran — the first env's persist failure
      // did not abort the loop.
      expect(envSeen).toEqual(["prod", "staging"]);
      // The failure was logged (isolated), not propagated.
      expect(mockLogger.error).toHaveBeenCalled();
    });

    /**
     * Fail-open OBSERVABILITY (P3 review item 2). When the catalog
     * `resolveSystemEnvironments` read fails and the executor degrades to a
     * single env-less run, it MUST emit a counter-style signal (not just a
     * `logger.warn`) so durable catalog misconfig / outage is observable.
     */
    it("broadcasts ENVIRONMENT_RESOLUTION_FAILED and degrades to one env-less run when the catalog read fails", async () => {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();
      const mockSignalService = createMockSignalService();

      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
      }));
      // The catalog read REJECTS — the executor must fail open.
      (mockCatalogClient as any).resolveSystemEnvironments = mock(async () => {
        throw new Error("catalog unavailable");
      });

      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 2) {
          return {
            from: mock(() => ({
              innerJoin: mock(() => ({
                where: mock(() =>
                  Promise.resolve([
                    {
                      configId: "config-1",
                      configName: "Check",
                      strategyId: "test-strategy",
                      config: { timeout: 5000 },
                      collectors: [
                        {
                          id: "col-1",
                          collectorId: "test-collector",
                          config: {},
                        },
                      ],
                      interval: 45,
                      enabled: true,
                      paused: false,
                      includeLocal: true,
                      satelliteIds: [],
                      environmentIds: null,
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => Promise.resolve([])),
            })),
          })),
        };
      });

      const envSeen: Array<string | undefined> = [];
      const collectorExecute = mock(
        async (params: { runContext?: { environment?: { id?: string } } }) => {
          envSeen.push(params.runContext?.environment?.id);
          return { result: {} };
        },
      );
      const mockCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => ({
          collector: {
            id: "test-collector",
            execute: collectorExecute,
            config: new Versioned({ version: 1, schema: z.object({}) }),
            mergeResult: mock(() => ({})),
          },
        })),
        getCollectors: mock(() => []),
      };

      const queue =
        mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
      let capturedHandler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined;
      (queue.consume as any) = mock(
        async (
          handler: (job: { data: HealthCheckJobPayload }) => Promise<void>,
        ) => {
          capturedHandler = handler;
        },
      );

      await setupHealthCheckWorker({
        db: mockDb as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["db"],
        advisoryLock: mockAdvisoryLock,
        registry: mockRegistry,
        collectorRegistry: mockCollectorRegistry as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["collectorRegistry"],
        logger: mockLogger,
        queueManager: mockQueueManager,
        signalService: mockSignalService,
        catalogClient: mockCatalogClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["catalogClient"],
        notificationClient: {
          notifyForSubscription: () => Promise.resolve({ notifiedCount: 0 }),
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
      });

      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1" },
        }).catch(() => {});
      }

      // Degraded to exactly one env-less run.
      expect(envSeen).toEqual([undefined]);
      // The observability signal was broadcast with the failure detail.
      const resolutionFailed = mockSignalService.getRecordedSignalsById(
        "healthcheck.environment.resolution_failed",
      );
      expect(resolutionFailed).toHaveLength(1);
      expect(
        (resolutionFailed[0]?.payload as { systemId?: string }).systemId,
      ).toBe("system-1");
    });
  });
});

describe("recomputeSystemRollupHealth", () => {
  /**
   * Verifies the pause/resume-driven rollup recompute:
   *  - With no `getHealthEntity` bound, `writeHealthEntity` runs `apply`
   *    directly, so the helper MUST call `service.getSystemHealthStatus` for
   *    the bare `<systemId>` rollup id (no env qualifier).
   *  - A `getSystemHealthStatus` failure must NOT propagate (the RPC must
   *    survive a transient recompute error).
   */
  it("calls service.getSystemHealthStatus(systemId) for the rollup when no entity handle is bound", async () => {
    const getSystemHealthStatus = mock(async () => ({
      status: "healthy" as const,
      evaluatedAt: new Date(),
      checkStatuses: [],
    }));
    const service = { getSystemHealthStatus } as never;

    await recomputeSystemRollupHealth({
      systemId: "sys-1",
      service,
      getHealthEntity: () => undefined,
      advisoryLock: mockAdvisoryLock,
      logger: createMockLogger(),
    });

    expect(getSystemHealthStatus).toHaveBeenCalledTimes(1);
    expect(getSystemHealthStatus).toHaveBeenCalledWith("sys-1");
  });

  it("swallows a recompute failure so the pause/resume RPC never throws", async () => {
    const getSystemHealthStatus = mock(async () => {
      throw new Error("db down");
    });
    const service = { getSystemHealthStatus } as never;
    const logger = createMockLogger();

    await expect(
      recomputeSystemRollupHealth({
        systemId: "sys-1",
        service,
        getHealthEntity: () => undefined,
        advisoryLock: mockAdvisoryLock,
        logger,
      }),
    ).resolves.toBeUndefined();

    // The error is logged for observability.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
