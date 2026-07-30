import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupHealthCheckWorker,
  scheduleHealthCheck,
  recomputeSystemRollupHealth,
  type HealthCheckJobPayload,
} from "./queue-executor";
import { createStubHealthCheckCache } from "./cache-test-stub";
import { SuspectLane } from "./suspect-lane";
import type { SlowCheckRuntime } from "./slow-check-config";

const passthroughCache = createStubHealthCheckCache();

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
        environmentId: null,
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
        environmentId: null,
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
        slowCheckRuntime: null,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Health Check Worker subscribed"),
      );
    });
  });

  // NOTE: `bootstrapHealthChecks` was removed in the per-environment-jobs
  // migration. Boot-time scheduling is now owned by `reconcileHealthCheckJobs`
  // (schedule-reconciler.ts), which converges the desired per-env recurring
  // job set from the durable tables + catalog membership; see
  // schedule-reconciler.test.ts for its coverage.

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
          // First call: fetch configuration (return paused config)
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
        slowCheckRuntime: null,
      });

      // Execute a paused health check
      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1", environmentId: null },
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

  describe("executeHealthCheckJob - satellite-only checks with no online satellite", () => {
    /**
     * Builds a worker whose one configuration is satellite-ONLY (includeLocal
     * false, satellites assigned) and captures the queue handler.
     */
    const setupSatelliteOnlyWorker = async (opts: {
      getOnlineSatelliteIds?: () => Promise<string[]>;
      /** Override the assignment shape to model a configuration change. */
      configRow?: Partial<{
        includeLocal: boolean;
        satelliteIds: string[];
        paused: boolean;
      }>;
      /** Records every subscriber notification the run would deliver. */
      onNotify?: (input: unknown) => void;
    }) => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockSignalService = createMockSignalService();
      const mockCatalogClient = createMockCatalogClient();

      // The shared mock has no `selectDistinct`; the rollup read uses it.
      (mockDb as any).selectDistinct = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([])),
        })),
      }));

      (mockDb.select as any) = mock(() => ({
        from: mock(() => ({
          innerJoin: mock(() => ({
            where: mock(() =>
              Promise.resolve([
                {
                  configId: "config-1",
                  configName: "Satellite check",
                  strategyId: "test-strategy",
                  config: {},
                  collectors: [],
                  interval: 30,
                  enabled: true,
                  // The shape this branch exists for: executed by satellites,
                  // never by the core. Overridable so a test can model an
                  // assignment change.
                  paused: false,
                  includeLocal: false,
                  satelliteIds: ["sat-1", "sat-2"],
                  environmentIds: null,
                  ...opts.configRow,
                },
              ]),
            ),
          })),
          where: mock(() => Promise.resolve([])),
        })),
      }));

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
        registry: createMockRegistry(),
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
        notificationClient: {
          notifyForSubscription: (input: unknown) => {
            opts.onNotify?.(input);
            return Promise.resolve({ notifiedCount: 0 });
          },
        } as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["notificationClient"],
        maintenanceClient: createMockMaintenanceClient() as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["maintenanceClient"],
        incidentClient: createMockIncidentClient() as unknown as Parameters<
          typeof setupHealthCheckWorker
        >[0]["incidentClient"],
        getEmitHook: () => undefined,
        cache: passthroughCache,
        slowCheckRuntime: null,
        ...(opts.getOnlineSatelliteIds
          ? { getOnlineSatelliteIds: opts.getOnlineSatelliteIds }
          : {}),
      });

      return { capturedHandler, mockLogger, mockSignalService };
    };

    const run = async (
      handler:
        | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
        | undefined,
    ) => {
      await handler?.({
        data: {
          configId: "config-1",
          systemId: "system-1",
          environmentId: null,
        },
      });
    };

    it("stays silent while at least one assigned satellite is online", async () => {
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => ["sat-2"],
      });

      await run(capturedHandler);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("satellite-only, skipping local execution"),
      );
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
    });

    it("warns and records a run when NO assigned satellite is online", async () => {
      // The regression this guards: the core used to return silently here, so a
      // check whose satellites were all down kept displaying its last known
      // status forever - a dead probe reading exactly like a passing one.
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => [],
      });

      // `persistRunAndReact` needs the full insert/aggregate/entity chain, which
      // this file's mock database does not provide - so the call throws HERE and
      // not in production, where it is the same function every successful run
      // goes through. That is a mock limit, not the behaviour under test: what
      // this pins is that the executor took the RECORD path instead of the
      // silent one. What gets recorded is pinned separately and purely by
      // `buildUnobservableRun` in `satellite-liveness.test.ts`.
      await run(capturedHandler).catch(() => {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
      // It must NOT take the silent path.
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining("satellite-only, skipping local execution"),
      );
    });

    it("stays silent when satellite liveness cannot be resolved", async () => {
      // A transient failure to reach the satellite service must never mark every
      // satellite-only check in the fleet degraded at once.
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => {
          throw new Error("satellite service unreachable");
        },
      });

      await run(capturedHandler);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("satellite-only, skipping local execution"),
      );
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
    });

    it("stays silent when no liveness resolver is wired at all", async () => {
      // Pre-existing behaviour for a deployment without the resolver: the core
      // says nothing and lets the satellites report.
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({});

      await run(capturedHandler);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("satellite-only, skipping local execution"),
      );
    });

    /**
     * An operator CHANGING an assignment must never look like a failure. These
     * are the cases that have historically been got wrong: the platform reacts
     * to a deliberate configuration change as though the check had broken.
     */
    it("records nothing when the satellites are removed from the assignment", async () => {
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        // No satellite is online at all - but the assignment no longer names
        // any, so this check is simply not satellite-only any more.
        getOnlineSatelliteIds: async () => [],
        configRow: { satelliteIds: [] },
      });

      await run(capturedHandler).catch(() => {});

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
    });

    it("records nothing when local execution is turned back on", async () => {
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => [],
        configRow: { includeLocal: true },
      });

      await run(capturedHandler).catch(() => {});

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
    });

    it("a PAUSED satellite-only check records nothing, even with every satellite offline", async () => {
      // Paused is checked BEFORE the satellite branch, so a paused check is
      // quiet on purpose and must not manufacture a degraded run.
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => [],
        configRow: { paused: true },
      });

      await run(capturedHandler).catch(() => {});

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("is paused, skipping execution"),
      );
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
    });

    it("does NOT notify subscribers for the unobservable run", async () => {
      // One offline satellite degrades EVERY check assigned to it in the same
      // tick, and healthy -> degraded is an escalation, so notifying per check
      // turns a single root cause into one alert per check. The satellite's own
      // connectivity subscription reports the cause once. The RUN is still
      // recorded - only the per-check alert is withheld.
      const notified: unknown[] = [];
      const { capturedHandler, mockLogger } = await setupSatelliteOnlyWorker({
        getOnlineSatelliteIds: async () => [],
        onNotify: (input) => notified.push(input),
      });

      await run(capturedHandler).catch(() => {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no online satellite"),
      );
      expect(notified).toHaveLength(0);
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

      // Catalog resolves the system name + free-form metadata.
      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
        metadata: { baseUrl: "https://web-01.example.com" },
      }));

      // configName is null -> run-context check.name must fall back to id.
      let selectCallCount = 0;
      (mockDb.select as any) = mock(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
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
        slowCheckRuntime: null,
      });

      if (capturedHandler) {
        // The collector runs early in the execution sequence; downstream
        // aggregation/persistence touches DB surfaces the lightweight mock
        // doesn't model, so tolerate a later throw — the run-context we
        // assert on is captured synchronously at collector-execute time.
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1", environmentId: null },
        }).catch(() => {});
      }

      expect(collectorExecute).toHaveBeenCalled();
      expect(capturedRunContext).toEqual({
        check: { id: "config-1", name: "config-1", intervalSeconds: 45 },
        system: {
          id: "system-1",
          name: "web-01",
          metadata: { baseUrl: "https://web-01.example.com" },
        },
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
        if (selectCallCount === 1) {
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
        slowCheckRuntime: null,
      });

      if (capturedHandler) {
        await capturedHandler({
          data: { configId: "config-1", systemId: "system-1", environmentId: null },
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

  describe("executeHealthCheckJob - per-environment jobs (single env per job)", () => {
    /**
     * Drive ONE job for a single (config, system, environment) slice, capturing
     * the run-context handed to the collector. Under the per-environment-jobs
     * model each recurring job runs EXACTLY ONE environment (its
     * `payload.environmentId`); the executor validates that env against the
     * CURRENT effective set (from the assignment `environmentIds` + catalog
     * membership) and SKIPS the tick when the slice is stale. So the captured
     * run list is either one run (the payload's env) or empty (skipped).
     */
    async function runSingleEnv({
      payloadEnvironmentId,
      environmentIds,
      membership,
      collectorConfig = {},
      collectorConfigSchema = z.object({}),
      failCatalogResolution = false,
      systemMetadata = {},
    }: {
      /** The env this job runs (`null` = an env-less job). */
      payloadEnvironmentId: string | null;
      /** The assignment's stored `environmentIds` selector. */
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
      /** When true, the catalog membership read REJECTS (fail-open path). */
      failCatalogResolution?: boolean;
      /** The system's free-form catalog metadata (`{{ system.metadata.* }}`). */
      systemMetadata?: Record<string, unknown>;
    }): Promise<{
      /** Run-context captured for the single run (empty when skipped). */
      runs: Array<{ environment?: unknown; system?: unknown; config?: unknown }>;
      /** Payloads broadcast on `healthcheck.run.completed`, in order. */
      runCompletedPayloads: Array<Record<string, unknown>>;
    }> {
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
        metadata: systemMetadata,
      }));
      (mockCatalogClient as any).resolveSystemEnvironments = mock(async () => {
        if (failCatalogResolution) throw new Error("catalog unavailable");
        return membership.map((m) => ({
          ...m,
          description: null,
          systemIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      });

      // The default full select chain (from().where(), groupBy, orderBy, ...)
      // so the durable persist path (aggregate read + rollup) resolves instead
      // of throwing on an unmodelled query shape - which is what lets the run
      // reach the `HEALTH_CHECK_RUN_COMPLETED` broadcast.
      const defaultSelect = mockDb.select;
      let selectCallCount = 0;
      (mockDb.select as any) = mock((...args: unknown[]) => {
        selectCallCount++;
        if (selectCallCount === 1) {
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
        return (defaultSelect as (...a: unknown[]) => unknown)(...args);
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
        slowCheckRuntime: null,
      });

      if (capturedHandler) {
        // Downstream persistence touches DB surfaces the lightweight mock
        // doesn't fully model; tolerate a later throw - run-contexts are
        // captured synchronously at collector-execute time.
        await capturedHandler({
          data: {
            configId: "config-1",
            systemId: "system-1",
            environmentId: payloadEnvironmentId,
          },
        }).catch(() => {});
      }

      const runCompletedPayloads = mockSignalService
        .getRecordedSignalsById("healthcheck.run.completed")
        .map((r) => z.record(z.string(), z.unknown()).parse(r.payload));

      return { runs: captured, runCompletedPayloads };
    }

    it("runs the payload's environment with that env in run-context", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: "prod",
        environmentIds: null,
        membership: [
          { id: "prod", name: "Production", metadata: { baseUrl: "p" } },
          { id: "staging", name: "Staging", metadata: { baseUrl: "s" } },
        ],
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toEqual({
        id: "prod",
        name: "Production",
        fields: { baseUrl: "p" },
      });
    });

    it("broadcasts the environment on run.completed for an env-scoped run", async () => {
      const { runCompletedPayloads } = await runSingleEnv({
        payloadEnvironmentId: "staging",
        environmentIds: null,
        membership: [
          { id: "prod", name: "Production", metadata: { baseUrl: "p" } },
          { id: "staging", name: "Staging", metadata: { baseUrl: "s" } },
        ],
      });

      expect(runCompletedPayloads).toHaveLength(1);
      expect(runCompletedPayloads[0]).toMatchObject({
        environmentId: "staging",
        environmentName: "Staging",
      });
    });

    it("omits the environment on run.completed for an env-less run", async () => {
      const { runCompletedPayloads } = await runSingleEnv({
        payloadEnvironmentId: null,
        environmentIds: [],
        membership: [{ id: "prod", name: "Production", metadata: {} }],
      });

      expect(runCompletedPayloads).toHaveLength(1);
      // Zod optionals are omitted when unset, so env-less runs are unchanged.
      expect(runCompletedPayloads[0]?.environmentId).toBeUndefined();
      expect(runCompletedPayloads[0]?.environmentName).toBeUndefined();
    });

    it("renders x-templatable config fields against the payload environment", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: "prod",
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

      expect(captured).toHaveLength(1);
      // The run renders against ITS env (prod), not staging (per-env render).
      expect((captured[0]?.config as { url: string }).url).toBe(
        "https://prod.example.com/healthz",
      );
    });

    it("renders environment.* to empty string for an env-less run (render-empty, §11.6)", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: null,
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
      // Missing path renders empty (strict: false) - the HTTP collector's
      // post-render .url() check turns this into a clear config error.
      expect((captured[0]?.config as { url: string }).url).toBe("/healthz");
    });

    it("renders {{ system.metadata.<key> }} from the system's catalog custom fields", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: null,
        environmentIds: [],
        membership: [{ id: "prod", name: "Production", metadata: {} }],
        systemMetadata: { baseUrl: "https://sys.example.com" },
        collectorConfig: { url: "{{ system.metadata.baseUrl }}/healthz" },
        collectorConfigSchema: z.object({
          url: configString({ "x-templatable": true }),
        }),
      });

      expect(captured).toHaveLength(1);
      expect((captured[0]?.config as { url: string }).url).toBe(
        "https://sys.example.com/healthz",
      );
    });

    it("namespaces metadata under .metadata so a custom field cannot shadow system.name", async () => {
      // A metadata key literally named `name` must NOT override the structural
      // `{{ system.name }}`; it is only reachable at `{{ system.metadata.name }}`.
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: null,
        environmentIds: [],
        membership: [{ id: "prod", name: "Production", metadata: {} }],
        systemMetadata: { name: "shadow-attempt" },
        collectorConfig: {
          structural: "{{ system.name }}",
          custom: "{{ system.metadata.name }}",
        },
        collectorConfigSchema: z.object({
          structural: configString({ "x-templatable": true }),
          custom: configString({ "x-templatable": true }),
        }),
      });

      expect(captured).toHaveLength(1);
      const config = captured[0]?.config as {
        structural: string;
        custom: string;
      };
      expect(config.structural).toBe("web-01");
      expect(config.custom).toBe("shadow-attempt");
    });

    it("runs the explicit-subset environment the payload targets", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: "staging",
        environmentIds: ["staging"],
        membership: [
          { id: "prod", name: "Production", metadata: {} },
          { id: "staging", name: "Staging", metadata: {} },
        ],
      });

      expect(captured).toHaveLength(1);
      expect((captured[0]?.environment as { id: string }).id).toBe("staging");
    });

    it("runs env-less when the system has no environments (null selector, empty membership)", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: null,
        environmentIds: null,
        membership: [],
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toBeUndefined();
    });

    it("skips a stale env-less job once the system has environments", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: null,
        environmentIds: null,
        membership: [
          { id: "prod", name: "Production", metadata: {} },
          { id: "staging", name: "Staging", metadata: {} },
        ],
      });

      // The env-less slice is stale (the system now has effective envs); the
      // reconciler owns converging to per-env jobs, so this tick is skipped.
      expect(captured).toHaveLength(0);
    });

    it("skips a job whose environment is no longer effective", async () => {
      const { runs: captured } = await runSingleEnv({
        payloadEnvironmentId: "prod",
        environmentIds: ["staging"],
        membership: [
          { id: "prod", name: "Production", metadata: {} },
          { id: "staging", name: "Staging", metadata: {} },
        ],
      });

      // `prod` is no longer in the effective subset ({staging}); skip the tick
      // and let the reconciler cancel this orphaned job.
      expect(captured).toHaveLength(0);
    });

    /**
     * Fail-open OBSERVABILITY (P3 review item 2). When the catalog
     * `resolveSystemEnvironments` read fails, an env-SCOPED job keeps running
     * its own env with degraded (empty) fields rather than skipping, and MUST
     * emit a counter-style signal (not just a `logger.warn`) so durable catalog
     * misconfig / outage is observable.
     */
    it("runs a degraded env-scoped probe and broadcasts ENVIRONMENT_RESOLUTION_FAILED when the catalog read fails", async () => {
      const mockSignalService = createMockSignalService();
      const { runs: captured, runCompletedPayloads } = await runSingleEnvWithSignals(
        {
          payloadEnvironmentId: "prod",
          environmentIds: null,
          membership: [],
          failCatalogResolution: true,
          signalService: mockSignalService,
        },
      );

      // Degraded to exactly one env-scoped run keeping its env id (empty fields).
      expect(captured).toHaveLength(1);
      expect(captured[0]?.environment).toEqual({
        id: "prod",
        name: "prod",
        fields: {},
      });
      expect(runCompletedPayloads).toHaveLength(1);

      const resolutionFailed = mockSignalService.getRecordedSignalsById(
        "healthcheck.environment.resolution_failed",
      );
      expect(resolutionFailed).toHaveLength(1);
      expect(
        (resolutionFailed[0]?.payload as { systemId?: string }).systemId,
      ).toBe("system-1");
    });

    /**
     * Same driver as `runSingleEnv` but with a caller-supplied signal service,
     * so the resolution-failed test can assert on the recorded signals.
     */
    async function runSingleEnvWithSignals({
      payloadEnvironmentId,
      environmentIds,
      membership,
      failCatalogResolution = false,
      signalService,
    }: {
      payloadEnvironmentId: string | null;
      environmentIds: string[] | null;
      membership: Array<{
        id: string;
        name: string;
        metadata: Record<string, unknown> | null;
      }>;
      failCatalogResolution?: boolean;
      signalService: ReturnType<typeof createMockSignalService>;
    }): Promise<{
      runs: Array<{ environment?: unknown; config?: unknown }>;
      runCompletedPayloads: Array<Record<string, unknown>>;
    }> {
      const mockDb = createMockDb();
      const mockRegistry = createMockRegistry();
      const mockLogger = createMockLogger();
      const mockQueueManager = createMockQueueManager();
      const mockCatalogClient = createMockCatalogClient();
      const mockMaintenanceClient = createMockMaintenanceClient();
      const mockIncidentClient = createMockIncidentClient();

      (mockCatalogClient.getSystem as any) = mock(async () => ({
        id: "system-1",
        name: "web-01",
      }));
      (mockCatalogClient as any).resolveSystemEnvironments = mock(async () => {
        if (failCatalogResolution) throw new Error("catalog unavailable");
        return membership.map((m) => ({
          ...m,
          description: null,
          systemIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      });

      const defaultSelect = mockDb.select;
      let selectCallCount = 0;
      (mockDb.select as any) = mock((...args: unknown[]) => {
        selectCallCount++;
        if (selectCallCount === 1) {
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
                      environmentIds,
                    },
                  ]),
                ),
              })),
            })),
          };
        }
        return (defaultSelect as (...a: unknown[]) => unknown)(...args);
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
        signalService,
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
        slowCheckRuntime: null,
      });

      if (capturedHandler) {
        await capturedHandler({
          data: {
            configId: "config-1",
            systemId: "system-1",
            environmentId: payloadEnvironmentId,
          },
        }).catch(() => {});
      }

      const runCompletedPayloads = signalService
        .getRecordedSignalsById("healthcheck.run.completed")
        .map((r) => z.record(z.string(), z.unknown()).parse(r.payload));

      return { runs: captured, runCompletedPayloads };
    }
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

describe("executeHealthCheckJob - structured assertion outcomes", () => {
  it("stores _assertions per collector entry and downgrades on failure", async () => {
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

    // One collector entry with two assertions: isTrue passes, equals fails.
    let selectCallCount = 0;
    (mockDb.select as any) = mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() =>
                Promise.resolve([
                  {
                    configId: "config-1",
                    configName: "checkout",
                    strategyId: "test-strategy",
                    config: { timeout: 5000 },
                    collectors: [
                      {
                        id: "col-1",
                        collectorId: "test-collector",
                        config: {},
                        assertions: [
                          { field: "ok", operator: "isTrue" },
                          { field: "code", operator: "equals", value: 200 },
                        ],
                      },
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

    // Capture every insert's values so we can find the stored run.
    const insertedValues: Record<string, unknown>[] = [];
    (mockDb.insert as any) = mock(() => ({
      values: mock((vals: Record<string, unknown>) => {
        insertedValues.push(vals);
        return Object.assign(Promise.resolve(), {
          onConflictDoUpdate: mock(() => Promise.resolve()),
          onConflictDoNothing: mock(() => Promise.resolve()),
          returning: mock(() => Promise.resolve([])),
        });
      }),
    }));

    const mockCollectorRegistry = {
      register: mock(() => {}),
      getCollector: mock(() => ({
        collector: {
          id: "test-collector",
          execute: mock(async () => ({ result: { ok: true, code: 404 } })),
          config: new Versioned({ version: 1, schema: z.object({}) }),
          result: new Versioned({
            version: 1,
            schema: z.object({ ok: z.boolean(), code: z.number() }),
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
      slowCheckRuntime: null,
    });

    if (capturedHandler) {
      // Downstream aggregation touches DB surfaces the lightweight mock
      // doesn't model; the run insert we assert on happens before that.
      await capturedHandler({
        data: { configId: "config-1", systemId: "system-1", environmentId: null },
      }).catch(() => {});
    }

    const runInsert = insertedValues.find(
      (vals) => "status" in vals && "result" in vals,
    );
    expect(runInsert).toBeDefined();
    // The failed `code equals 200` assertion downgrades the run.
    expect(runInsert?.status).toBe("unhealthy");

    const runResult = runInsert?.result as {
      metadata: {
        collectors: Record<
          string,
          {
            _assertionFailed?: string;
            _assertions?: {
              field: string;
              passed: boolean;
              actual?: string;
            }[];
          }
        >;
      };
    };
    const entry = runResult.metadata.collectors["col-1"];
    expect(entry._assertionFailed).toBe("code equals 200");
    expect(entry._assertions?.length).toBe(2);
    expect(entry._assertions?.[0]).toMatchObject({
      field: "ok",
      passed: true,
      actual: "true",
    });
    expect(entry._assertions?.[1]).toMatchObject({
      field: "code",
      passed: false,
      actual: "404",
    });
  });
});

describe("executeHealthCheckJob - slow-check bulkhead wiring", () => {
  function makeRuntime(lane: SuspectLane): SlowCheckRuntime {
    return {
      lane,
      recentRunsLimit: 20,
      classifierParams: {
        consecutiveFailures: 3,
        slowFraction: 0.8,
        recoveryProbeEvery: 5,
      },
      safetyFactor: 1.5,
      absoluteFloorMs: 1000,
    };
  }

  const TIMEOUT = 5000;
  const slowFail = () => ({
    environment_id: null,
    environmentId: null,
    status: "unhealthy" as const,
    latencyMs: TIMEOUT,
    timestamp: new Date(),
  });

  /**
   * Drive ONE env-less job with the slow-check bulkhead enabled and a
   * configurable recent-run history + lane. Captures whether the collector
   * executed and whether a durable run was inserted.
   */
  async function runWithBulkhead({
    recentRuns,
    slowCheckRuntime,
  }: {
    recentRuns: Array<{ environmentId: string | null; status: "healthy" | "unhealthy"; latencyMs: number | null; timestamp: Date }>;
    slowCheckRuntime: SlowCheckRuntime;
  }): Promise<{ collectorRan: boolean; runInserted: boolean }> {
    const mockDb = createMockDb();
    const mockRegistry = createMockRegistry();
    const mockLogger = createMockLogger();
    const mockQueueManager = createMockQueueManager();
    const mockCatalogClient = createMockCatalogClient();
    const mockMaintenanceClient = createMockMaintenanceClient();
    const mockIncidentClient = createMockIncidentClient();
    const mockSignalService = createMockSignalService();

    (mockCatalogClient.getSystem as any) = mock(async () => ({ id: "system-1", name: "web-01" }));
    (mockCatalogClient as any).resolveSystemEnvironments = mock(async () => []);

    // Select call order: #1 config, #2 fetchRecentRunsForSlice. Everything else
    // falls through to default. (The eager rollup-prev read that used to be #1
    // is now computed lazily only on the catastrophic-failure path.)
    const defaultSelect = mockDb.select;
    let selectCallCount = 0;
    (mockDb.select as any) = mock((...args: unknown[]) => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() =>
                Promise.resolve([
                  {
                    configId: "config-1",
                    configName: "Check",
                    strategyId: "test-strategy",
                    config: { timeout: TIMEOUT },
                    collectors: [
                      { id: "col-1", collectorId: "test-collector", config: {} },
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
      if (selectCallCount === 2) {
        return {
          from: mock(() => ({
            where: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(() => Promise.resolve(recentRuns)),
              })),
            })),
          })),
        };
      }
      return (defaultSelect as (...a: unknown[]) => unknown)(...args);
    });

    let runInserted = false;
    (mockDb.insert as any) = mock(() => ({
      values: mock((vals: Record<string, unknown>) => {
        if (vals && "status" in vals) runInserted = true;
        return Promise.resolve();
      }),
    }));

    let collectorRan = false;
    const collectorExecute = mock(async () => {
      collectorRan = true;
      return { result: {} };
    });
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

    const queue = mockQueueManager.getQueue<HealthCheckJobPayload>("health-checks");
    let capturedHandler:
      | ((job: { data: HealthCheckJobPayload }) => Promise<void>)
      | undefined;
    (queue.consume as any) = mock(
      async (handler: (job: { data: HealthCheckJobPayload }) => Promise<void>) => {
        capturedHandler = handler;
      },
    );

    await setupHealthCheckWorker({
      db: mockDb as unknown as Parameters<typeof setupHealthCheckWorker>[0]["db"],
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
      } as unknown as Parameters<typeof setupHealthCheckWorker>[0]["notificationClient"],
      maintenanceClient: mockMaintenanceClient as unknown as Parameters<
        typeof setupHealthCheckWorker
      >[0]["maintenanceClient"],
      incidentClient: mockIncidentClient as unknown as Parameters<
        typeof setupHealthCheckWorker
      >[0]["incidentClient"],
      getEmitHook: () => undefined,
      cache: passthroughCache,
      slowCheckRuntime,
    });

    if (capturedHandler) {
      await capturedHandler({
        data: { configId: "config-1", systemId: "system-1", environmentId: null },
      }).catch(() => {});
    }

    return { collectorRan, runInserted };
  }

  it("DEFERS a suspect slice when the lane is full — records nothing, never probes", async () => {
    const lane = new SuspectLane(1);
    lane.tryAdmit("other:slice:_"); // fill the only slot with a different slice
    const { collectorRan, runInserted } = await runWithBulkhead({
      recentRuns: [slowFail(), slowFail(), slowFail()],
      slowCheckRuntime: makeRuntime(lane),
    });

    // Deferred BEFORE the probe: no collector execution, no durable run row.
    expect(collectorRan).toBe(false);
    expect(runInserted).toBe(false);
  });

  it("runs a suspect slice when the lane has room, and frees the slot after", async () => {
    const lane = new SuspectLane(1);
    const { collectorRan, runInserted } = await runWithBulkhead({
      recentRuns: [slowFail(), slowFail(), slowFail()],
      slowCheckRuntime: makeRuntime(lane),
    });

    expect(collectorRan).toBe(true);
    expect(runInserted).toBe(true);
    // The slot was released in the executor's finally.
    expect(lane.active).toBe(0);
  });

  it("does NOT gate a healthy slice (no recent slow failures)", async () => {
    const lane = new SuspectLane(1);
    lane.tryAdmit("other:slice:_"); // lane full, but the slice is NOT suspect
    const { collectorRan, runInserted } = await runWithBulkhead({
      recentRuns: [
        { environmentId: null, status: "healthy", latencyMs: 40, timestamp: new Date() },
      ],
      slowCheckRuntime: makeRuntime(lane),
    });

    // Healthy slices never touch the lane, so a full lane doesn't defer them.
    expect(collectorRan).toBe(true);
    expect(runInserted).toBe(true);
  });
});
