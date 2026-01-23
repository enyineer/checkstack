import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";

describe("HealthCheckService.getAggregatedHistory", () => {
  // Mock database and registry
  let mockDb: ReturnType<typeof createMockDb>;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockCollectorRegistry: { getCollector: ReturnType<typeof mock> };
  let service: HealthCheckService;
  // Store mock data for different queries
  let mockConfigResult: { id: string; strategyId: string } | null = null;
  let mockRunsResult: unknown[] = [];
  let mockHourlyAggregates: unknown[] = [];
  let mockDailyAggregates: unknown[] = [];
  let selectCallCount = 0;

  function createMockDb() {
    // Reset call counter on creation
    selectCallCount = 0;

    // Create a mock that handles:
    // 1. Config query (uses limit(1))
    // 2. Raw runs query (first orderBy after where)
    // 3. Hourly aggregates query (second orderBy after where)
    // 4. Daily aggregates query (third orderBy after where)
    const createSelectChain = () => {
      const currentCall = selectCallCount++;

      return {
        from: mock(() => ({
          where: mock(() => ({
            // For config query: uses .limit(1)
            limit: mock(() =>
              Promise.resolve(mockConfigResult ? [mockConfigResult] : []),
            ),
            // For runs/aggregates queries: uses .orderBy()
            orderBy: mock(() => {
              // Call 1: raw runs, Call 2: hourly, Call 3: daily
              if (currentCall === 1) return Promise.resolve(mockRunsResult);
              if (currentCall === 2)
                return Promise.resolve(mockHourlyAggregates);
              if (currentCall === 3)
                return Promise.resolve(mockDailyAggregates);
              return Promise.resolve([]);
            }),
          })),
        })),
      };
    };

    return {
      select: mock(createSelectChain),
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
        mergeResult: mock((existing: { totalRuns?: number } | undefined) => ({
          totalRuns: (existing?.totalRuns ?? 0) + 1,
          customMetric: "aggregated",
        })),
      })),
    };
  }

  beforeEach(() => {
    // Reset mock data
    mockConfigResult = null;
    mockRunsResult = [];
    mockHourlyAggregates = [];
    mockDailyAggregates = [];
    mockDb = createMockDb();
    mockRegistry = createMockRegistry();
    mockCollectorRegistry = { getCollector: mock(() => undefined) };
    service = new HealthCheckService(
      mockDb as never,
      mockRegistry as never,
      mockCollectorRegistry as never,
    );
  });

  describe("dynamic bucket interval calculation", () => {
    it("returns bucketIntervalSeconds in response", async () => {
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-02T00:00:00Z"); // 24 hours

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 500,
        },
        { includeAggregatedResult: true },
      );

      // 24 hours = 86400 seconds / 500 target points = ~173 seconds per bucket
      expect(result.bucketIntervalSeconds).toBe(173);
      expect(result.buckets).toEqual([]);
    });

    it("calculates interval based on targetPoints", async () => {
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-01T01:00:00Z"); // 1 hour

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 100,
        },
        { includeAggregatedResult: true },
      );

      // 1 hour = 3600 seconds / 100 target points = 36 seconds per bucket
      expect(result.bucketIntervalSeconds).toBe(36);
    });

    it("enforces minimum interval of 1 second", async () => {
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-01T00:00:10Z"); // 10 seconds

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 2000, // Would result in 0.005s intervals without minimum
        },
        { includeAggregatedResult: true },
      );

      // Minimum interval is 1 second
      expect(result.bucketIntervalSeconds).toBe(1);
    });
  });

  describe("bucketing and metrics calculation", () => {
    it("groups runs into dynamic buckets and calculates metrics", async () => {
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: { statusCode: 200 },
          timestamp: new Date("2024-01-01T10:00:10Z"),
        },
        {
          id: "run-2",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 150,
          result: { statusCode: 200 },
          timestamp: new Date("2024-01-01T10:00:20Z"),
        },
        {
          id: "run-3",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "unhealthy" as const,
          latencyMs: 300,
          result: { statusCode: 500 },
          timestamp: new Date("2024-01-01T10:01:00Z"),
        },
      ];

      // Setup mock data
      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      // Query for 1 hour with 60 target points = 1 minute buckets
      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T10:00:00Z"),
          endDate: new Date("2024-01-01T11:00:00Z"),
          targetPoints: 60,
        },
        { includeAggregatedResult: true },
      );

      // Should be ~60s buckets
      expect(result.bucketIntervalSeconds).toBe(60);

      // First two runs should be in the same bucket (00:10 and 00:20), third in next (01:00)
      expect(result.buckets).toHaveLength(2);

      // First bucket should have 2 runs
      const firstBucket = result.buckets[0];
      expect(firstBucket.runCount).toBe(2);
      expect(firstBucket.healthyCount).toBe(2);
      expect(firstBucket.unhealthyCount).toBe(0);
      expect(firstBucket.successRate).toBe(1);
      expect(firstBucket.avgLatencyMs).toBe(125);

      // Second bucket should have 1 run
      const secondBucket = result.buckets[1];
      expect(secondBucket.runCount).toBe(1);
      expect(secondBucket.healthyCount).toBe(0);
      expect(secondBucket.unhealthyCount).toBe(1);
      expect(secondBucket.successRate).toBe(0);
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

      // Setup mock data
      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T10:00:00Z"),
          endDate: new Date("2024-01-01T11:00:00Z"),
        },
        { includeAggregatedResult: true },
      );

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].p95LatencyMs).toBe(190); // 95th percentile of 100-195
    });
  });

  describe("strategy metadata aggregation", () => {
    it("calls strategy.mergeResult for each run in bucket", async () => {
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

      // Setup mock data
      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T10:00:00Z"),
          endDate: new Date("2024-01-01T11:00:00Z"),
        },
        { includeAggregatedResult: true },
      );

      const bucket = result.buckets[0];
      expect(
        "aggregatedResult" in bucket && bucket.aggregatedResult,
      ).toMatchObject({
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

      // Setup mock data - no config found means no strategy
      mockRunsResult = runs;
      mockConfigResult = null;

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T10:00:00Z"),
          endDate: new Date("2024-01-01T11:00:00Z"),
        },
        { includeAggregatedResult: true },
      );

      const bucket = result.buckets[0];
      expect(
        "aggregatedResult" in bucket ? bucket.aggregatedResult : undefined,
      ).toBeUndefined();
    });
  });

  describe("bucketIntervalSeconds in buckets", () => {
    it("includes bucketIntervalSeconds in each bucket", async () => {
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
          timestamp: new Date("2024-01-02T10:00:00Z"),
        },
      ];

      // Setup mock data
      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T00:00:00Z"),
          endDate: new Date("2024-01-03T00:00:00Z"),
          targetPoints: 48, // 2 days / 48 = 1 hour buckets
        },
        { includeAggregatedResult: true },
      );

      expect(result.buckets).toHaveLength(2);

      // Each bucket should have bucketIntervalSeconds
      expect(result.buckets[0].bucketIntervalSeconds).toBe(3600); // 1 hour
      expect(result.buckets[1].bucketIntervalSeconds).toBe(3600);
    });
  });

  describe("collector data aggregation", () => {
    it("aggregates collector data per bucket using collector's aggregateResult", async () => {
      // Runs with collector data in metadata.collectors
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 100,
          result: {
            metadata: {
              collectors: {
                "uuid-1": {
                  _collectorId: "healthcheck-http.request",
                  responseTimeMs: 100,
                  success: true,
                },
              },
            },
          },
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
        {
          id: "run-2",
          systemId: "sys-1",
          configurationId: "config-1",
          status: "healthy" as const,
          latencyMs: 150,
          result: {
            metadata: {
              collectors: {
                "uuid-1": {
                  _collectorId: "healthcheck-http.request",
                  responseTimeMs: 200,
                  success: true,
                },
              },
            },
          },
          timestamp: new Date("2024-01-01T10:30:00Z"),
        },
      ];

      // Create a mock collector that aggregates response times
      const mockCollectorRegistry = {
        getCollector: mock((collectorId: string) => {
          if (collectorId === "healthcheck-http.request") {
            return {
              collector: {
                mergeResult: (
                  existing: Record<string, unknown> | undefined,
                  newRun: {
                    status: string;
                    metadata?: Record<string, unknown>;
                  },
                ) => {
                  const prevSum = (existing?.sumResponseTimeMs as number) ?? 0;
                  const prevCount = (existing?.count as number) ?? 0;
                  const responseTime =
                    (newRun.metadata?.responseTimeMs as number) ?? 0;
                  const newSum = prevSum + responseTime;
                  const newCount = prevCount + 1;
                  return {
                    sumResponseTimeMs: newSum,
                    count: newCount,
                    avgResponseTimeMs: newSum / newCount,
                    successRate: 100,
                  };
                },
              },
            };
          }
          return undefined;
        }),
      };

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      // Create a fresh mock db for this test (resets call counter)
      const freshMockDb = createMockDb();

      // Create service with mock collector registry
      const serviceWithCollectors = new HealthCheckService(
        freshMockDb as never,
        mockRegistry as never,
        mockCollectorRegistry as never,
      );

      const result = await serviceWithCollectors.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate: new Date("2024-01-01T10:00:00Z"),
          endDate: new Date("2024-01-01T11:00:00Z"),
          targetPoints: 1, // Single bucket for the whole hour
        },
        { includeAggregatedResult: true },
      );

      expect(result.buckets).toHaveLength(1);

      const bucket = result.buckets[0];
      expect("aggregatedResult" in bucket).toBe(true);

      const aggregatedResult = (
        bucket as { aggregatedResult: Record<string, unknown> }
      ).aggregatedResult;
      expect(aggregatedResult.collectors).toBeDefined();

      const collectors = aggregatedResult.collectors as Record<string, unknown>;
      const collectorData = collectors["uuid-1"] as Record<string, unknown>;

      expect(collectorData._collectorId).toBe("healthcheck-http.request");
      expect(collectorData.avgResponseTimeMs).toBe(150); // Average of 100 and 200
      expect(collectorData.successRate).toBe(100);
    });
  });

  describe("recent runs near endDate - edge case for live data", () => {
    /**
     * This test suite verifies that runs occurring close to the query endDate
     * are properly included in the last bucket. This is critical for real-time
     * dashboards where users expect to see data up to "now".
     *
     * Scenario: User queries "Last 7 days" and runs have been occurring every minute.
     * The last bucket should include runs up to the endDate, not stop at a previous
     * bucket boundary.
     */

    it("includes runs right up to endDate in the last bucket", async () => {
      // Simulate a 7-day query range that creates ~23 minute buckets
      // 7 days = 604,800 seconds / 500 target points = 1,209.6 seconds (~20 min) per bucket
      const endDate = new Date("2026-01-20T22:05:00Z"); // Current time
      const startDate = new Date("2026-01-13T22:05:00Z"); // 7 days ago

      // Create runs: some old ones and some very recent ones near endDate
      const runs = [
        // Old run at the start of the range
        {
          id: "run-old-1",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "healthy" as const,
          latencyMs: 100,
          result: { statusCode: 200 },
          timestamp: new Date("2026-01-13T22:10:00Z"),
        },
        // Run ~25 minutes before endDate
        {
          id: "run-recent-1",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 2500,
          result: { statusCode: 500 },
          timestamp: new Date("2026-01-20T21:40:00Z"),
        },
        // Run ~15 minutes before endDate
        {
          id: "run-recent-2",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 3000,
          result: { statusCode: 503 },
          timestamp: new Date("2026-01-20T21:50:00Z"),
        },
        // Run ~5 minutes before endDate
        {
          id: "run-recent-3",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 2800,
          result: { statusCode: 502 },
          timestamp: new Date("2026-01-20T22:00:00Z"),
        },
        // Run 2 minutes before endDate - SHOULD BE IN LAST BUCKET
        {
          id: "run-recent-4",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 2600,
          result: { statusCode: 500 },
          timestamp: new Date("2026-01-20T22:03:00Z"),
        },
        // Run 1 minute before endDate - SHOULD BE IN LAST BUCKET
        {
          id: "run-recent-5",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 2700,
          result: { statusCode: 500 },
          timestamp: new Date("2026-01-20T22:04:00Z"),
        },
      ];

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 500,
        },
        { includeAggregatedResult: true },
      );

      // We should have buckets that cover the entire range
      expect(result.buckets.length).toBeGreaterThan(0);

      // Find the last bucket
      const lastBucket = result.buckets[result.buckets.length - 1];

      // The last bucket should contain runs from the most recent times
      // Specifically, the runs at 22:03 and 22:04 should be in some bucket
      const allRunCounts = result.buckets.reduce(
        (sum, b) => sum + b.runCount,
        0,
      );
      expect(allRunCounts).toBe(6); // All 6 runs should be accounted for

      // The last bucket's bucketStart + interval should cover endDate
      const bucketIntervalMs = result.bucketIntervalSeconds * 1000;
      const lastBucketEnd = new Date(
        lastBucket.bucketStart.getTime() + bucketIntervalMs,
      );

      // Last bucket should extend close to endDate
      // (within one bucket interval of endDate)
      expect(lastBucketEnd.getTime()).toBeGreaterThanOrEqual(
        endDate.getTime() - bucketIntervalMs,
      );
    });

    it("includes partial last bucket when endDate is mid-bucket", async () => {
      // Scenario: Query ends at a time that's not aligned to bucket boundaries
      // Runs exist right before endDate and should still appear
      const startDate = new Date("2026-01-20T21:00:00Z");
      const endDate = new Date("2026-01-20T22:00:00Z"); // 1 hour range

      // Create runs every 5 minutes for the hour
      const runs = [];
      for (let i = 0; i < 12; i++) {
        runs.push({
          id: `run-${i}`,
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "healthy" as const,
          latencyMs: 100 + i * 10,
          result: { statusCode: 200 },
          timestamp: new Date(
            startDate.getTime() + i * 5 * 60 * 1000, // Every 5 minutes
          ),
        });
      }

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      // Use 10 target points = 6 minute buckets
      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 10,
        },
        { includeAggregatedResult: true },
      );

      // All 12 runs should be accounted for in the buckets
      const allRunCounts = result.buckets.reduce(
        (sum, b) => sum + b.runCount,
        0,
      );
      expect(allRunCounts).toBe(12);

      // Last bucket should exist and have runs in it
      const lastBucket = result.buckets[result.buckets.length - 1];
      expect(lastBucket.runCount).toBeGreaterThan(0);

      // The run at 21:55 (55 minutes after start) should be in a bucket
      // That's in bucket index floor(55/6) = 9 (the last bucket)
      expect(result.buckets.length).toBe(10);
    });

    it("handles runs at exact endDate boundary", async () => {
      const startDate = new Date("2026-01-20T21:00:00Z");
      const endDate = new Date("2026-01-20T22:00:00Z");

      const runs = [
        {
          id: "run-start",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "healthy" as const,
          latencyMs: 100,
          result: { statusCode: 200 },
          timestamp: new Date("2026-01-20T21:00:00Z"), // Exact start
        },
        {
          id: "run-end",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 5000,
          result: { statusCode: 500 },
          timestamp: new Date("2026-01-20T22:00:00Z"), // Exact end
        },
      ];

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 10,
        },
        { includeAggregatedResult: true },
      );

      // Both runs should be included
      const allRunCounts = result.buckets.reduce(
        (sum, b) => sum + b.runCount,
        0,
      );
      expect(allRunCounts).toBe(2);

      // First bucket should have the start run
      expect(result.buckets[0].runCount).toBeGreaterThan(0);

      // Last bucket should have the end run
      const lastBucket = result.buckets[result.buckets.length - 1];
      expect(lastBucket.runCount).toBeGreaterThan(0);
    });

    it("simulates real-world 7-day dashboard with minute-by-minute runs", async () => {
      /**
       * Real-world simulation:
       * - 7 day query range
       * - Health check runs every minute
       * - Query with 500 target points (~20 min buckets)
       * - Recent runs should appear in the latest bucket
       */
      const endDate = new Date("2026-01-20T22:05:00Z");
      const startDate = new Date("2026-01-13T22:05:00Z");

      // Create runs for the last 30 minutes (simulates recent activity)
      const runs = [];
      for (let i = 0; i < 30; i++) {
        const timestamp = new Date(endDate.getTime() - (30 - i) * 60 * 1000);
        runs.push({
          id: `run-${i}`,
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: i % 3 === 0 ? ("unhealthy" as const) : ("healthy" as const),
          latencyMs: 100 + i * 10,
          result: { statusCode: i % 3 === 0 ? 500 : 200 },
          timestamp,
        });
      }

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 500,
        },
        { includeAggregatedResult: true },
      );

      // Verify bucket interval is roughly 20 minutes for 7-day / 500 points
      // 7 days = 604,800 seconds / 500 = 1,209.6 seconds (~20 min)
      expect(result.bucketIntervalSeconds).toBe(1210);

      // All 30 runs should be in buckets
      const allRunCounts = result.buckets.reduce(
        (sum, b) => sum + b.runCount,
        0,
      );
      expect(allRunCounts).toBe(30);

      // The most recent run (at endDate - 1 minute) should be in a bucket
      // This is the critical assertion for the bug we're fixing
      const lastBucket = result.buckets[result.buckets.length - 1];

      // Last bucket should have some runs
      expect(lastBucket.runCount).toBeGreaterThan(0);

      // The last bucket's end time should be near endDate
      const bucketIntervalMs = result.bucketIntervalSeconds * 1000;
      const lastBucketEnd = new Date(
        lastBucket.bucketStart.getTime() + bucketIntervalMs,
      );

      // Last bucket should extend to cover the endDate or be within one interval
      const timeDiffMs = endDate.getTime() - lastBucketEnd.getTime();
      expect(timeDiffMs).toBeLessThan(bucketIntervalMs);
    });

    it("verifies last bucket contains the most recent timestamp", async () => {
      const startDate = new Date("2026-01-20T21:00:00Z");
      const endDate = new Date("2026-01-20T22:05:00Z"); // 65 minutes

      // Create runs with known timestamps
      const runs = [
        {
          id: "run-1",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "healthy" as const,
          latencyMs: 100,
          result: {},
          timestamp: new Date("2026-01-20T21:05:00Z"),
        },
        {
          id: "run-2",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "healthy" as const,
          latencyMs: 100,
          result: {},
          timestamp: new Date("2026-01-20T21:35:00Z"),
        },
        // Most recent run - 2 minutes before endDate
        {
          id: "run-latest",
          systemId: "sys-1",
          configurationId: "config-1",
          strategyId: "http",
          status: "unhealthy" as const,
          latencyMs: 5000,
          result: { statusCode: 500 },
          timestamp: new Date("2026-01-20T22:03:00Z"),
        },
      ];

      mockRunsResult = runs;
      mockConfigResult = { id: "config-1", strategyId: "http" };

      // Use 5 target points = 13 minute buckets
      const result = await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "config-1",
          startDate,
          endDate,
          targetPoints: 5,
        },
        { includeAggregatedResult: true },
      );

      expect(result.buckets.length).toBeGreaterThan(0);

      // All 3 runs should be included
      const allRunCounts = result.buckets.reduce(
        (sum, b) => sum + b.runCount,
        0,
      );
      expect(allRunCounts).toBe(3);

      // The last bucket should have the unhealthy run
      const lastBucket = result.buckets[result.buckets.length - 1];
      expect(lastBucket.unhealthyCount).toBe(1);

      // Bucket containing 22:03 run should have bucketStart before 22:03
      expect(lastBucket.bucketStart.getTime()).toBeLessThanOrEqual(
        new Date("2026-01-20T22:03:00Z").getTime(),
      );
    });
  });
});
