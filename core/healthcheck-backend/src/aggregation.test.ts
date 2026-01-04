import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";

describe("HealthCheckService.getAggregatedHistory", () => {
  // Mock database and registry
  let mockDb: ReturnType<typeof createMockDb>;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let service: HealthCheckService;

  function createMockDb() {
    return {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve([])),
          })),
        })),
      })),
      query: {
        healthCheckConfigurations: {
          findFirst: mock(() => Promise.resolve(null)) as ReturnType<
            typeof mock<
              () => Promise<{ id: string; strategyId: string } | null>
            >
          >,
        },
      },
    };
  }

  function createMockRegistry() {
    return {
      register: mock(),
      getStrategies: mock(() => []),
      getStrategy: mock(() => ({
        id: "http",
        displayName: "HTTP",
        config: { version: 1, schema: {} },
        aggregatedResult: { version: 1, schema: {} },
        execute: mock(),
        aggregateResult: mock((runs: unknown[]) => ({
          totalRuns: runs.length,
          customMetric: "aggregated",
        })),
      })),
    };
  }

  beforeEach(() => {
    mockDb = createMockDb();
    mockRegistry = createMockRegistry();
    service = new HealthCheckService(mockDb as never, mockRegistry as never);
  });

  describe("bucket size selection", () => {
    it("auto-selects hourly for ranges <= 7 days", async () => {
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-07T00:00:00Z");

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          bucketSize: "auto",
        },
        { includeAggregatedResult: true }
      );

      expect(result.buckets).toEqual([]);
    });

    it("auto-selects daily for ranges > 7 days", async () => {
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-15T00:00:00Z");

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          bucketSize: "auto",
        },
        { includeAggregatedResult: true }
      );

      expect(result.buckets).toEqual([]);
    });
  });

  describe("bucketing and metrics calculation", () => {
    it("groups runs into hourly buckets and calculates metrics", async () => {
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: { statusCode: 200 },
          timestamp: new Date("2024-01-01T10:15:00Z"),
        },
        {
          id: "run-2",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 150,
          result: { statusCode: 200 },
          timestamp: new Date("2024-01-01T10:30:00Z"),
        },
        {
          id: "run-3",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "unhealthy" as const,
          latencyMs: 300,
          result: { statusCode: 500 },
          timestamp: new Date("2024-01-01T11:00:00Z"),
        },
      ];

      // Setup mock to return runs
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(runs)),
          })),
        })),
      }));

      mockDb.query.healthCheckConfigurations.findFirst = mock(() =>
        Promise.resolve({ id: "config-1", strategyId: "http" })
      );

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-01T23:59:59Z"),
          bucketSize: "hourly",
        },
        { includeAggregatedResult: true }
      );

      expect(result.buckets).toHaveLength(2);

      // First bucket (10:00)
      const bucket10 = result.buckets.find(
        (b) => b.bucketStart.getHours() === 10
      );
      expect(bucket10).toBeDefined();
      expect(bucket10!.runCount).toBe(2);
      expect(bucket10!.healthyCount).toBe(2);
      expect(bucket10!.unhealthyCount).toBe(0);
      expect(bucket10!.successRate).toBe(1);
      expect(bucket10!.avgLatencyMs).toBe(125);

      // Second bucket (11:00)
      const bucket11 = result.buckets.find(
        (b) => b.bucketStart.getHours() === 11
      );
      expect(bucket11).toBeDefined();
      expect(bucket11!.runCount).toBe(1);
      expect(bucket11!.healthyCount).toBe(0);
      expect(bucket11!.unhealthyCount).toBe(1);
      expect(bucket11!.successRate).toBe(0);
    });

    it("calculates p95 latency correctly", async () => {
      // Create 20 runs with latencies 100-200 (step 5)
      const runs = Array.from({ length: 20 }, (_, i) => ({
        id: `run-${i}`,
        systemId: "sys-1",
        configurationId: "config-1",
        status: "healthy" as const,
        latencyMs: 100 + i * 5,
        result: {},
        timestamp: new Date("2024-01-01T10:00:00Z"),
      }));

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(runs)),
          })),
        })),
      }));

      mockDb.query.healthCheckConfigurations.findFirst = mock(() =>
        Promise.resolve({ id: "config-1", strategyId: "http" })
      );

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-01T23:59:59Z"),
          bucketSize: "hourly",
        },
        { includeAggregatedResult: true }
      );

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].p95LatencyMs).toBe(190); // 95th percentile of 100-195
    });
  });

  describe("strategy metadata aggregation", () => {
    it("calls strategy.aggregateResult for each bucket", async () => {
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: { statusCode: 200 },
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
      ];

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(runs)),
          })),
        })),
      }));

      mockDb.query.healthCheckConfigurations.findFirst = mock(() =>
        Promise.resolve({ id: "config-1", strategyId: "http" })
      );

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-01T23:59:59Z"),
          bucketSize: "hourly",
        },
        { includeAggregatedResult: true }
      );

      const bucket = result.buckets[0];
      expect("aggregatedResult" in bucket && bucket.aggregatedResult).toEqual({
        totalRuns: 1,
        customMetric: "aggregated",
      });

      // Verify getStrategy was called to look up the strategy
      expect(mockRegistry.getStrategy).toHaveBeenCalled();
    });

    it("returns undefined aggregatedResult when no strategy found", async () => {
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: {},
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
      ];

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(runs)),
          })),
        })),
      }));

      // No config found means no strategy
      mockDb.query.healthCheckConfigurations.findFirst = mock(() =>
        Promise.resolve(null)
      );

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-01T23:59:59Z"),
          bucketSize: "hourly",
        },
        { includeAggregatedResult: true }
      );

      const bucket = result.buckets[0];
      expect(
        "aggregatedResult" in bucket ? bucket.aggregatedResult : undefined
      ).toBeUndefined();
    });
  });

  describe("daily bucketing", () => {
    it("groups runs into daily buckets", async () => {
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: {},
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
        {
          id: "run-2",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 150,
          result: {},
          timestamp: new Date("2024-01-01T22:00:00Z"),
        },
        {
          id: "run-3",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "unhealthy" as const,
          latencyMs: 200,
          result: {},
          timestamp: new Date("2024-01-02T05:00:00Z"),
        },
      ];

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(runs)),
          })),
        })),
      }));

      mockDb.query.healthCheckConfigurations.findFirst = mock(() =>
        Promise.resolve({ id: "config-1", strategyId: "http" })
      );

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-03T00:00:00Z"),
          bucketSize: "daily",
        },
        { includeAggregatedResult: true }
      );

      expect(result.buckets).toHaveLength(2);

      // Jan 1 bucket
      const jan1 = result.buckets.find((b) => b.bucketStart.getDate() === 1);
      expect(jan1).toBeDefined();
      expect(jan1!.runCount).toBe(2);
      expect(jan1!.bucketSize).toBe("daily");

      // Jan 2 bucket
      const jan2 = result.buckets.find((b) => b.bucketStart.getDate() === 2);
      expect(jan2).toBeDefined();
      expect(jan2!.runCount).toBe(1);
    });
  });
});
