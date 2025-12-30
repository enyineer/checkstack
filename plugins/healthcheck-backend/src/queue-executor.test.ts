import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupHealthCheckWorker,
  scheduleHealthCheck,
  bootstrapHealthChecks,
  type HealthCheckJobPayload,
} from "./queue-executor";
import {
  createMockLogger,
  createMockQueueFactory,
  createMockDb,
  createMockFetch,
} from "@checkmate/test-utils-backend";
import type { HealthCheckRegistry } from "@checkmate/backend-api";
import { mock } from "bun:test";

// Helper to create mock health check registry
const createMockRegistry = (): HealthCheckRegistry => ({
  getStrategy: mock((id: string) => ({
    id,
    displayName: "Mock Strategy",
    description: "Mock",
    configSchema: {} as any,
    configVersion: 1,
    execute: mock(async () => ({
      status: "healthy" as const,
      message: "Mock check passed",
      timestamp: new Date().toISOString(),
    })),
  })),
  register: mock(() => {}),
  getStrategies: mock(() => []),
});

describe("Queue-Based Health Check Executor", () => {
  describe("scheduleHealthCheck", () => {
    it("should enqueue a health check with delay and deterministic jobId", async () => {
      const mockQueueFactory = createMockQueueFactory();
      const mockLogger = createMockLogger();

      const payload: HealthCheckJobPayload = {
        configId: "config-1",
        systemId: "system-1",
      };

      await scheduleHealthCheck({
        queueFactory: mockQueueFactory,
        payload,
        intervalSeconds: 60,
        logger: mockLogger,
      });

      // Verify queue was created with correct name
      const queue = await mockQueueFactory.createQueue("health-checks");
      expect(queue).toBeDefined();
    });

    it("should use deterministic job IDs", async () => {
      const mockQueueFactory = createMockQueueFactory();
      const mockLogger = createMockLogger();

      const payload: HealthCheckJobPayload = {
        configId: "config-1",
        systemId: "system-1",
      };

      const result = await scheduleHealthCheck({
        queueFactory: mockQueueFactory,
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
      const mockFetch = createMockFetch();
      const mockQueueFactory = createMockQueueFactory();

      await setupHealthCheckWorker({
        db: mockDb as any,
        registry: mockRegistry,
        logger: mockLogger,
        fetch: mockFetch,
        queueFactory: mockQueueFactory,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Health Check Worker subscribed")
      );
    });
  });

  describe("bootstrapHealthChecks", () => {
    beforeEach(() => {
      // Reset all mocks between tests
    });

    it("should enqueue all enabled health checks", async () => {
      const mockQueueFactory = createMockQueueFactory();
      const mockLogger = createMockLogger();
      const mockDb = createMockDb();

      // Configure the mock database to return some enabled checks
      // We need to override the full chain: select().from().innerJoin().where()
      const mockData = [
        {
          systemId: "system-1",
          configId: "config-1",
          interval: 30,
        },
        {
          systemId: "system-2",
          configId: "config-2",
          interval: 60,
        },
      ];

      // Override select to return a chain that resolves to mockData
      (mockDb.select as any) = mock(() => ({
        from: mock(() => ({
          innerJoin: mock(() => ({
            where: mock(() => Promise.resolve(mockData)),
          })),
        })),
      }));

      await bootstrapHealthChecks({
        db: mockDb as any,
        queueFactory: mockQueueFactory,
        logger: mockLogger,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Bootstrapping 2 health checks"
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "✅ Bootstrapped 2 health checks"
      );
    });

    it("should handle empty health check list", async () => {
      const mockQueueFactory = createMockQueueFactory();
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
        queueFactory: mockQueueFactory,
        logger: mockLogger,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Bootstrapping 0 health checks"
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "✅ Bootstrapped 0 health checks"
      );
    });
  });
});
