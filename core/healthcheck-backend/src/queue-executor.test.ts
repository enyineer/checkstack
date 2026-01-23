import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupHealthCheckWorker,
  scheduleHealthCheck,
  bootstrapHealthChecks,
  type HealthCheckJobPayload,
} from "./queue-executor";
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
      schema: z.object({}),
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
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
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
        maintenanceClient: mockMaintenanceClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: mockIncidentClient as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
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
});
