import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { InferSelectModel } from "drizzle-orm";
import { HealthCheckService } from "./service";
import {
  healthCheckRuns,
  systemHealthChecks,
  healthCheckConfigurations,
} from "./schema";

/**
 * Tests for correct data ordering in service methods.
 * Verifies the Parametric Sort-at-Source standard:
 * - getSystemHealthOverview returns runs in chronological order (oldest first) for sparklines
 * - getHistory and getDetailedHistory respect the sortOrder parameter
 */
describe("HealthCheckService data ordering", () => {
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let service: HealthCheckService;

  // Use real types from schema to catch schema drift
  type HealthCheckRun = InferSelectModel<typeof healthCheckRuns>;
  type SystemHealthCheck = InferSelectModel<typeof systemHealthChecks>;
  type HealthCheckConfiguration = InferSelectModel<
    typeof healthCheckConfigurations
  >;

  // Mock data storage - using Partial to allow minimal test data
  type MockAssociation = Pick<
    SystemHealthCheck,
    "configurationId" | "enabled" | "stateThresholds"
  > &
    Pick<HealthCheckConfiguration, "strategyId" | "intervalSeconds"> & {
      configName: string;
    };
  let mockAssociations: MockAssociation[] = [];
  let mockRuns: Partial<HealthCheckRun>[] = [];

  function createMockRegistry() {
    return {
      register: mock(),
      getStrategies: mock(() => []),
      getStrategy: mock(() => null),
    };
  }

  function createMockDb() {
    // Create a comprehensive mock that handles all query patterns
    // The service uses different patterns:
    // - getHistory/getDetailedHistory: .orderBy().limit().offset()
    // - getSystemHealthOverview: .orderBy().limit() (no offset)
    const offsetMock = mock(() => Promise.resolve([...mockRuns]));

    // limitMock needs to be both a thenable (for await) and have .offset()
    const createLimitResult = () => {
      const result = Promise.resolve([...mockRuns]);
      // @ts-expect-error - Adding offset to Promise
      result.offset = offsetMock;
      return result;
    };

    const orderByMock = mock(() => ({
      limit: mock(createLimitResult),
    }));
    const whereMock = mock(() => ({
      orderBy: orderByMock,
      limit: mock(createLimitResult),
    }));
    const innerJoinMock = mock(() => ({
      where: mock(() => Promise.resolve([...mockAssociations])),
    }));
    const fromMock = mock(() => ({
      where: whereMock,
      innerJoin: innerJoinMock,
      orderBy: orderByMock,
    }));

    return {
      select: mock(() => ({ from: fromMock })),
      $count: mock(() => Promise.resolve(mockRuns.length)),
    };
  }

  beforeEach(() => {
    mockAssociations = [];
    mockRuns = [];
    mockRegistry = createMockRegistry();
  });

  describe("getSystemHealthOverview", () => {
    it("returns recentRuns in chronological order (oldest first) for sparkline display", async () => {
      // Setup: Runs that would be returned from DB in DESC order (newest first)
      const oldRun = {
        id: "run-old",
        status: "healthy" as const,
        timestamp: new Date("2024-01-01T10:00:00Z"),
      };
      const midRun = {
        id: "run-mid",
        status: "degraded" as const,
        timestamp: new Date("2024-01-01T11:00:00Z"),
      };
      const newRun = {
        id: "run-new",
        status: "unhealthy" as const,
        timestamp: new Date("2024-01-01T12:00:00Z"),
      };

      mockAssociations = [
        {
          configurationId: "config-1",
          configName: "Test Config",
          strategyId: "http",
          intervalSeconds: 60,
          enabled: true,
          stateThresholds: null,
        },
      ];

      // DB returns DESC order (newest first) - service should reverse for sparkline
      mockRuns = [newRun, midRun, oldRun];

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getSystemHealthOverview("system-1");

      // Verify recentRuns are in chronological order (oldest first)
      // This is what sparklines expect: oldest on left, newest on right
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].recentRuns).toHaveLength(3);
      expect(result.checks[0].recentRuns[0].id).toBe("run-old"); // Oldest first
      expect(result.checks[0].recentRuns[1].id).toBe("run-mid");
      expect(result.checks[0].recentRuns[2].id).toBe("run-new"); // Newest last
    });

    it("returns most recent 25 runs in chronological order", async () => {
      mockAssociations = [
        {
          configurationId: "config-1",
          configName: "Test Config",
          strategyId: "http",
          intervalSeconds: 60,
          enabled: true,
          stateThresholds: null,
        },
      ];

      // Create 25 runs in DESC order (how DB returns them)
      mockRuns = Array.from({ length: 25 }, (_, i) => ({
        id: `run-${24 - i}`, // 24 down to 0 (newest to oldest)
        status: "healthy" as const,
        timestamp: new Date(
          `2024-01-01T${String(24 - i).padStart(2, "0")}:00:00Z`,
        ),
      }));

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getSystemHealthOverview("system-1");

      // After service reverses: oldest (run-0) should be first, newest (run-24) last
      expect(result.checks[0].recentRuns).toHaveLength(25);
      expect(result.checks[0].recentRuns[0].id).toBe("run-0"); // Oldest first
      expect(result.checks[0].recentRuns[24].id).toBe("run-24"); // Newest last
    });
  });

  describe("getHistory sortOrder parameter", () => {
    it("respects sortOrder asc - returns runs in chronological order", async () => {
      // Simulate DB returning runs in ASC order
      mockRuns = [
        {
          id: "1",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
        {
          id: "2",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T11:00:00Z"),
        },
        {
          id: "3",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T12:00:00Z"),
        },
      ];

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getHistory({
        systemId: "sys-1",
        configurationId: "config-1",
        sortOrder: "asc",
        limit: 10,
      });

      // Verify runs are returned as-is from mock (ASC order)
      expect(result.runs[0].id).toBe("1"); // Oldest first
      expect(result.runs[2].id).toBe("3"); // Newest last
    });

    it("respects sortOrder desc - returns runs in reverse chronological order", async () => {
      // Simulate DB returning runs in DESC order
      mockRuns = [
        {
          id: "3",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T12:00:00Z"),
        },
        {
          id: "2",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T11:00:00Z"),
        },
        {
          id: "1",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
      ];

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getHistory({
        systemId: "sys-1",
        configurationId: "config-1",
        sortOrder: "desc",
        limit: 10,
      });

      // Verify runs are returned as-is from mock (DESC order)
      expect(result.runs[0].id).toBe("3"); // Newest first
      expect(result.runs[2].id).toBe("1"); // Oldest last
    });
  });

  describe("getDetailedHistory sortOrder parameter", () => {
    it("respects sortOrder asc - returns runs in chronological order", async () => {
      // Simulate DB returning runs in ASC order
      mockRuns = [
        {
          id: "1",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T10:00:00Z"),
          latencyMs: 100,
          result: {},
        },
        {
          id: "2",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T11:00:00Z"),
          latencyMs: 150,
          result: {},
        },
      ];

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getDetailedHistory({
        systemId: "sys-1",
        configurationId: "config-1",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        sortOrder: "asc",
        limit: 10,
        offset: 0,
      });

      // Verify runs are returned in ASC order
      expect(result.runs[0].id).toBe("1"); // Oldest first
      expect(result.runs[1].id).toBe("2"); // Newest last
    });

    it("respects sortOrder desc - returns runs in reverse chronological order", async () => {
      // Simulate DB returning runs in DESC order
      mockRuns = [
        {
          id: "2",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T11:00:00Z"),
          latencyMs: 150,
          result: {},
        },
        {
          id: "1",
          status: "healthy" as const,
          timestamp: new Date("2024-01-01T10:00:00Z"),
          latencyMs: 100,
          result: {},
        },
      ];

      const mockDb = createMockDb();
      service = new HealthCheckService(mockDb as never, mockRegistry as never, {} as never);

      const result = await service.getDetailedHistory({
        systemId: "sys-1",
        configurationId: "config-1",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        sortOrder: "desc",
        limit: 10,
        offset: 0,
      });

      // Verify runs are returned in DESC order
      expect(result.runs[0].id).toBe("2"); // Newest first
      expect(result.runs[1].id).toBe("1"); // Oldest last
    });
  });
});
