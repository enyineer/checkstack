import { describe, it, expect, mock } from "bun:test";
import {
  calculatePercentile,
  calculateLatencyStats,
  countStatuses,
  extractLatencies,
  mergeTieredBuckets,
  combineBuckets,
  reaggregateBuckets,
  mergeAggregatedBucketResults,
  type NormalizedBucket,
} from "./aggregation-utils";
import {
  VersionedAggregated,
  aggregatedCounter,
  aggregatedAverage,
  type CollectorRegistry,
  type HealthCheckRegistry,
} from "@checkstack/backend-api";

// Helper to create mock registries for testing
const createMockRegistries = () => {
  const collectorRegistry: CollectorRegistry = {
    register: mock(() => {}),
    getCollector: mock(() => undefined),
    getCollectors: mock(() => []),
    getCollectorsForPlugin: mock(() => []),
  };

  const registry: HealthCheckRegistry = {
    getStrategy: mock(() => undefined),
    register: mock(() => {}),
    getStrategies: mock(() => []),
    getStrategiesWithMeta: mock(() => []),
  };

  return { collectorRegistry, registry, strategyId: "test-strategy" };
};

// Helper to create a NormalizedBucket for testing
function createBucket(params: {
  startMs: number;
  durationMs: number;
  runCount?: number;
  healthyCount?: number;
  degradedCount?: number;
  unhealthyCount?: number;
  latencySumMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  p95LatencyMs?: number;
  sourceTier: "raw" | "hourly" | "daily";
}): NormalizedBucket {
  return {
    bucketStart: new Date(params.startMs),
    bucketEndMs: params.startMs + params.durationMs,
    runCount: params.runCount ?? 10,
    healthyCount: params.healthyCount ?? 8,
    degradedCount: params.degradedCount ?? 1,
    unhealthyCount: params.unhealthyCount ?? 1,
    latencySumMs: params.latencySumMs ?? 1000,
    minLatencyMs: params.minLatencyMs ?? 50,
    maxLatencyMs: params.maxLatencyMs ?? 200,
    p95LatencyMs: params.p95LatencyMs ?? 180,
    sourceTier: params.sourceTier,
  };
}

describe("aggregation-utils", () => {
  describe("calculatePercentile", () => {
    it("calculates p95 for sorted array", () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(calculatePercentile(values, 95)).toBe(10);
    });

    it("calculates p50 (median)", () => {
      const values = [1, 2, 3, 4, 5];
      expect(calculatePercentile(values, 50)).toBe(3);
    });

    it("handles single value", () => {
      expect(calculatePercentile([42], 95)).toBe(42);
    });

    it("handles unsorted array", () => {
      const values = [5, 1, 4, 2, 3];
      expect(calculatePercentile(values, 50)).toBe(3);
    });
  });

  describe("calculateLatencyStats", () => {
    it("returns undefined stats for empty array", () => {
      const stats = calculateLatencyStats([]);
      expect(stats.avgLatencyMs).toBeUndefined();
      expect(stats.minLatencyMs).toBeUndefined();
      expect(stats.maxLatencyMs).toBeUndefined();
      expect(stats.p95LatencyMs).toBeUndefined();
      expect(stats.latencySumMs).toBeUndefined();
    });

    it("calculates all stats correctly", () => {
      const stats = calculateLatencyStats([100, 200, 300]);
      expect(stats.latencySumMs).toBe(600);
      expect(stats.avgLatencyMs).toBe(200);
      expect(stats.minLatencyMs).toBe(100);
      expect(stats.maxLatencyMs).toBe(300);
      expect(stats.p95LatencyMs).toBe(300);
    });

    it("handles single value", () => {
      const stats = calculateLatencyStats([150]);
      expect(stats.latencySumMs).toBe(150);
      expect(stats.avgLatencyMs).toBe(150);
      expect(stats.minLatencyMs).toBe(150);
      expect(stats.maxLatencyMs).toBe(150);
    });

    it("rounds average correctly", () => {
      // 100 + 101 = 201, avg = 100.5 -> rounds to 101
      const stats = calculateLatencyStats([100, 101]);
      expect(stats.avgLatencyMs).toBe(101);
    });
  });

  describe("countStatuses", () => {
    it("counts all status types correctly", () => {
      const runs = [
        { status: "healthy" as const },
        { status: "healthy" as const },
        { status: "degraded" as const },
        { status: "unhealthy" as const },
      ];
      const counts = countStatuses(runs);
      expect(counts.healthyCount).toBe(2);
      expect(counts.degradedCount).toBe(1);
      expect(counts.unhealthyCount).toBe(1);
    });

    it("handles empty array", () => {
      const counts = countStatuses([]);
      expect(counts.healthyCount).toBe(0);
      expect(counts.degradedCount).toBe(0);
      expect(counts.unhealthyCount).toBe(0);
    });

    it("handles all healthy", () => {
      const runs = [
        { status: "healthy" as const },
        { status: "healthy" as const },
      ];
      const counts = countStatuses(runs);
      expect(counts.healthyCount).toBe(2);
      expect(counts.degradedCount).toBe(0);
      expect(counts.unhealthyCount).toBe(0);
    });

    it("ignores unknown status values", () => {
      const runs = [
        { status: "healthy" as const },
        { status: "unknown" }, // Unknown status
      ];
      const counts = countStatuses(runs);
      expect(counts.healthyCount).toBe(1);
      expect(counts.degradedCount).toBe(0);
      expect(counts.unhealthyCount).toBe(0);
    });
  });

  describe("extractLatencies", () => {
    it("extracts latencies and filters undefined", () => {
      const runs = [
        { latencyMs: 100 },
        { latencyMs: undefined },
        { latencyMs: 200 },
      ];
      const latencies = extractLatencies(runs);
      expect(latencies).toEqual([100, 200]);
    });

    it("handles empty array", () => {
      expect(extractLatencies([])).toEqual([]);
    });

    it("handles all undefined latencies", () => {
      const runs = [{ latencyMs: undefined }, {}];
      expect(extractLatencies(runs)).toEqual([]);
    });

    it("handles missing latencyMs property", () => {
      const runs = [{}, { latencyMs: 100 }];
      expect(extractLatencies(runs)).toEqual([100]);
    });
  });

  describe("edge cases - data gaps and sparse data", () => {
    it("handles sparse latency data (gaps)", () => {
      // Simulate data where some runs failed and have no latency
      const runs = [
        { latencyMs: 100 },
        { latencyMs: undefined }, // Failed run, no latency
        { latencyMs: undefined }, // Failed run, no latency
        { latencyMs: 200 },
      ];
      const latencies = extractLatencies(runs);
      const stats = calculateLatencyStats(latencies);

      expect(latencies).toHaveLength(2);
      expect(stats.avgLatencyMs).toBe(150);
    });

    it("handles runs with varying metadata schemas", () => {
      // Simulate schema migration - older runs may have different metadata structure
      const runs = [
        { status: "healthy" as const, latencyMs: 100, metadata: {} },
        { status: "healthy" as const, latencyMs: 200 }, // No metadata (older schema)
        {
          status: "healthy" as const,
          latencyMs: 300,
          metadata: { newField: "value" },
        }, // New schema
      ];

      const counts = countStatuses(runs);
      const latencies = extractLatencies(runs);

      expect(counts.healthyCount).toBe(3);
      expect(latencies).toEqual([100, 200, 300]);
    });
  });

  // ===== Cross-Tier Aggregation Tests =====

  describe("mergeTieredBuckets", () => {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    it("returns empty array when all inputs are empty", () => {
      const result = mergeTieredBuckets({
        rawBuckets: [],
        hourlyBuckets: [],
        dailyBuckets: [],
      });
      expect(result).toEqual([]);
    });

    it("returns raw buckets when only raw data exists", () => {
      const rawBuckets = [
        createBucket({ startMs: 0, durationMs: MINUTE, sourceTier: "raw" }),
        createBucket({
          startMs: MINUTE,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets,
        hourlyBuckets: [],
        dailyBuckets: [],
      });

      expect(result).toHaveLength(2);
      expect(result[0].sourceTier).toBe("raw");
      expect(result[1].sourceTier).toBe("raw");
    });

    it("prefers raw over hourly for overlapping periods", () => {
      // Raw data from 0-2 minutes
      const rawBuckets = [
        createBucket({ startMs: 0, durationMs: MINUTE, sourceTier: "raw" }),
        createBucket({
          startMs: MINUTE,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
      ];

      // Hourly bucket covering 0-1 hour (overlaps with raw)
      const hourlyBuckets = [
        createBucket({ startMs: 0, durationMs: HOUR, sourceTier: "hourly" }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets,
        hourlyBuckets,
        dailyBuckets: [],
      });

      // Should have raw buckets, hourly is skipped due to overlap
      expect(result).toHaveLength(2);
      expect(result.every((b) => b.sourceTier === "raw")).toBe(true);
    });

    it("uses hourly when no raw data exists for a period", () => {
      // Raw data from 0-2 minutes
      const rawBuckets = [
        createBucket({ startMs: 0, durationMs: MINUTE, sourceTier: "raw" }),
      ];

      // Hourly bucket for hour 2 (no overlap)
      const hourlyBuckets = [
        createBucket({
          startMs: 2 * HOUR,
          durationMs: HOUR,
          sourceTier: "hourly",
        }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets,
        hourlyBuckets,
        dailyBuckets: [],
      });

      expect(result).toHaveLength(2);
      expect(result[0].sourceTier).toBe("raw");
      expect(result[1].sourceTier).toBe("hourly");
    });

    it("uses daily when no raw or hourly data exists", () => {
      const dailyBuckets = [
        createBucket({ startMs: 0, durationMs: DAY, sourceTier: "daily" }),
        createBucket({ startMs: DAY, durationMs: DAY, sourceTier: "daily" }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets: [],
        hourlyBuckets: [],
        dailyBuckets,
      });

      expect(result).toHaveLength(2);
      expect(result.every((b) => b.sourceTier === "daily")).toBe(true);
    });

    it("handles mixed tiers for different time periods", () => {
      // Day 1: only daily data
      // Day 2, hour 1: hourly data
      // Day 2, hour 2: raw data
      const dailyBuckets = [
        createBucket({ startMs: 0, durationMs: DAY, sourceTier: "daily" }),
      ];

      const hourlyBuckets = [
        createBucket({
          startMs: DAY,
          durationMs: HOUR,
          sourceTier: "hourly",
        }),
      ];

      const rawBuckets = [
        createBucket({
          startMs: DAY + 2 * HOUR,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets,
        hourlyBuckets,
        dailyBuckets,
      });

      expect(result).toHaveLength(3);
      expect(result[0].sourceTier).toBe("daily");
      expect(result[1].sourceTier).toBe("hourly");
      expect(result[2].sourceTier).toBe("raw");
    });

    it("raw buckets take precedence even when hourly starts earlier (regression test)", () => {
      /**
       * Regression test for the "Tail-End Stale" bug:
       * When an hourly aggregate (e.g., 21:00-22:00) exists and raw data
       * arrives mid-hour (e.g., 21:48), the raw data should take precedence,
       * not be blocked by the hourly aggregate.
       *
       * Bug scenario:
       * - Hourly aggregate: 21:00 to 22:00
       * - Raw buckets: 21:48 to 22:11 (fresh data)
       * - Old buggy behavior: hourly was processed first (earlier start time),
       *   set coveredUntil=22:00, and raw was skipped
       * - Correct behavior: raw always takes precedence, hourly is excluded
       */
      const baseTime = 21 * HOUR; // 21:00

      // Hourly bucket covering 21:00-22:00 (stale aggregate)
      const hourlyBuckets = [
        createBucket({
          startMs: baseTime,
          durationMs: HOUR,
          runCount: 60, // Old stale data
          sourceTier: "hourly",
        }),
      ];

      // Raw buckets at 21:48 and 22:00 (fresh data that should NOT be blocked)
      const rawBuckets = [
        createBucket({
          startMs: baseTime + 48 * MINUTE, // 21:48
          durationMs: 12 * MINUTE,
          runCount: 12, // Fresh data
          sourceTier: "raw",
        }),
        createBucket({
          startMs: baseTime + HOUR, // 22:00
          durationMs: 11 * MINUTE,
          runCount: 11, // Fresh data
          sourceTier: "raw",
        }),
      ];

      const result = mergeTieredBuckets({
        rawBuckets,
        hourlyBuckets,
        dailyBuckets: [],
      });

      // CRITICAL: Both raw buckets should be included
      expect(result).toHaveLength(2);
      expect(result[0].sourceTier).toBe("raw");
      expect(result[1].sourceTier).toBe("raw");
      expect(result[0].runCount).toBe(12); // 21:48 bucket
      expect(result[1].runCount).toBe(11); // 22:00 bucket

      // Hourly bucket should be excluded because raw data covers its range
      const hourlyInResult = result.find((b) => b.sourceTier === "hourly");
      expect(hourlyInResult).toBeUndefined();
    });
  });

  describe("combineBuckets", () => {
    const HOUR = 60 * 60 * 1000;

    it("returns empty bucket for empty input", () => {
      const targetStart = new Date(0);
      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets: [],
        targetBucketStart: targetStart,
        targetBucketEndMs: HOUR,
      });

      expect(result.runCount).toBe(0);
      expect(result.healthyCount).toBe(0);
      expect(result.latencySumMs).toBeUndefined();
    });

    it("sums counts correctly", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: HOUR,
          runCount: 10,
          healthyCount: 8,
          degradedCount: 1,
          unhealthyCount: 1,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR,
          durationMs: HOUR,
          runCount: 20,
          healthyCount: 15,
          degradedCount: 3,
          unhealthyCount: 2,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      expect(result.runCount).toBe(30);
      expect(result.healthyCount).toBe(23);
      expect(result.degradedCount).toBe(4);
      expect(result.unhealthyCount).toBe(3);
    });

    it("sums latencySumMs for accurate averaging", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: HOUR,
          latencySumMs: 1000,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR,
          durationMs: HOUR,
          latencySumMs: 2000,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      expect(result.latencySumMs).toBe(3000);
    });

    it("takes min of minLatencyMs values", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: HOUR,
          minLatencyMs: 100,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR,
          durationMs: HOUR,
          minLatencyMs: 50,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      expect(result.minLatencyMs).toBe(50);
    });

    it("takes max of maxLatencyMs values", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: HOUR,
          maxLatencyMs: 200,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR,
          durationMs: HOUR,
          maxLatencyMs: 300,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      expect(result.maxLatencyMs).toBe(300);
    });

    it("takes max of p95LatencyMs as upper-bound approximation", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: HOUR,
          p95LatencyMs: 150,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR,
          durationMs: HOUR,
          p95LatencyMs: 250,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      expect(result.p95LatencyMs).toBe(250);
    });

    it("tracks lowest priority tier in combined result", () => {
      const buckets: NormalizedBucket[] = [
        createBucket({ startMs: 0, durationMs: HOUR, sourceTier: "raw" }),
        createBucket({ startMs: HOUR, durationMs: HOUR, sourceTier: "hourly" }),
      ];

      const mocks = createMockRegistries();
      const result = combineBuckets({
        ...mocks,
        buckets,
        targetBucketStart: new Date(0),
        targetBucketEndMs: 2 * HOUR,
      });

      // hourly has lower priority (higher number) than raw
      expect(result.sourceTier).toBe("hourly");
    });
  });

  describe("reaggregateBuckets", () => {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    it("returns empty array for empty input", () => {
      const mocks = createMockRegistries();
      const result = reaggregateBuckets({
        ...mocks,
        sourceBuckets: [],
        targetIntervalMs: HOUR,
        rangeStart: new Date(0),
        rangeEnd: new Date(HOUR),
      });

      expect(result).toEqual([]);
    });

    it("groups minute buckets into hourly target", () => {
      // 3 minute-buckets in the first hour
      const sourceBuckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: MINUTE,
          runCount: 10,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: MINUTE,
          durationMs: MINUTE,
          runCount: 10,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: 2 * MINUTE,
          durationMs: MINUTE,
          runCount: 10,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = reaggregateBuckets({
        ...mocks,
        sourceBuckets,
        targetIntervalMs: HOUR,
        rangeStart: new Date(0),
        rangeEnd: new Date(HOUR),
      });

      expect(result).toHaveLength(1);
      expect(result[0].runCount).toBe(30);
    });

    it("creates separate target buckets for different intervals", () => {
      // 2 buckets in hour 0, 1 bucket in hour 1
      const sourceBuckets: NormalizedBucket[] = [
        createBucket({
          startMs: 0,
          durationMs: MINUTE,
          runCount: 10,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: MINUTE,
          durationMs: MINUTE,
          runCount: 10,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: HOUR + MINUTE,
          durationMs: MINUTE,
          runCount: 5,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = reaggregateBuckets({
        ...mocks,
        sourceBuckets,
        targetIntervalMs: HOUR,
        rangeStart: new Date(0),
        rangeEnd: new Date(2 * HOUR),
      });

      expect(result).toHaveLength(2);
      expect(result[0].runCount).toBe(20); // Hour 0
      expect(result[1].runCount).toBe(5); // Hour 1
    });

    it("aligns buckets to rangeStart", () => {
      const rangeStart = new Date(30 * MINUTE); // Start at minute 30
      const sourceBuckets: NormalizedBucket[] = [
        createBucket({
          startMs: 30 * MINUTE,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
        createBucket({
          startMs: 31 * MINUTE,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
      ];

      const mocks = createMockRegistries();
      const result = reaggregateBuckets({
        ...mocks,
        sourceBuckets,
        targetIntervalMs: HOUR,
        rangeStart,
        rangeEnd: new Date(rangeStart.getTime() + HOUR),
      });

      expect(result).toHaveLength(1);
      expect(result[0].bucketStart.getTime()).toBe(30 * MINUTE);
    });

    it("returns buckets sorted by start time", () => {
      // Input in reverse order
      const sourceBuckets: NormalizedBucket[] = [
        createBucket({
          startMs: 2 * HOUR,
          durationMs: MINUTE,
          sourceTier: "raw",
        }),
        createBucket({ startMs: 0, durationMs: MINUTE, sourceTier: "raw" }),
        createBucket({ startMs: HOUR, durationMs: MINUTE, sourceTier: "raw" }),
      ];

      const mocks = createMockRegistries();
      const result = reaggregateBuckets({
        ...mocks,
        sourceBuckets,
        targetIntervalMs: HOUR,
        rangeStart: new Date(0),
        rangeEnd: new Date(3 * HOUR),
      });

      expect(result).toHaveLength(3);
      expect(result[0].bucketStart.getTime()).toBe(0);
      expect(result[1].bucketStart.getTime()).toBe(HOUR);
      expect(result[2].bucketStart.getTime()).toBe(2 * HOUR);
    });
  });

  describe("mergeAggregatedBucketResults - strategy metadata merging", () => {
    it("merges strategy-level fields using strategy's mergeAggregatedStates", () => {
      // Create a strategy with VersionedAggregated that tracks error counts
      const strategyAggregatedResult = new VersionedAggregated({
        version: 1,
        fields: {
          errorCount: aggregatedCounter({}),
          avgResponseTime: aggregatedAverage({}),
        },
      });

      const mockRegistry: HealthCheckRegistry = {
        getStrategy: mock(() => ({
          id: "test-strategy",
          displayName: "Test",
          description: "Test",
          config: { version: 1 } as never,
          result: { version: 1 } as never,
          aggregatedResult: strategyAggregatedResult,
          createClient: mock() as never,
          mergeResult: mock() as never,
        })),
        register: mock(() => {}),
        getStrategies: mock(() => []),
        getStrategiesWithMeta: mock(() => []),
      };

      const mockCollectorRegistry: CollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => undefined),
        getCollectors: mock(() => []),
        getCollectorsForPlugin: mock(() => []),
      };

      // Two buckets with strategy-level aggregated data
      const bucket1 = {
        errorCount: { count: 5 },
        avgResponseTime: { _sum: 500, _count: 10, avg: 50 },
      };

      const bucket2 = {
        errorCount: { count: 3 },
        avgResponseTime: { _sum: 300, _count: 5, avg: 60 },
      };

      const result = mergeAggregatedBucketResults({
        aggregatedResults: [bucket1, bucket2],
        collectorRegistry: mockCollectorRegistry,
        registry: mockRegistry,
        strategyId: "test-strategy",
      });

      expect(result).toBeDefined();
      // Error count should be summed: 5 + 3 = 8
      expect((result as Record<string, unknown>).errorCount).toEqual({
        _type: "counter",
        count: 8,
      });
      // Average should be recomputed: (500 + 300) / (10 + 5) = 53.33
      const avgResult = (result as Record<string, unknown>)
        .avgResponseTime as Record<string, number>;
      expect(avgResult._sum).toBe(800);
      expect(avgResult._count).toBe(15);
      expect(avgResult.avg).toBeCloseTo(53.33, 1);
    });

    it("preserves strategy fields when only one bucket exists", () => {
      const mocks = createMockRegistries();

      const singleBucket = {
        errorCount: { count: 5 },
        avgResponseTime: { _sum: 500, _count: 10, avg: 50 },
      };

      const result = mergeAggregatedBucketResults({
        aggregatedResults: [singleBucket],
        ...mocks,
      });

      expect(result).toEqual(singleBucket);
    });

    it("returns undefined for empty aggregated results", () => {
      const mocks = createMockRegistries();

      const result = mergeAggregatedBucketResults({
        aggregatedResults: [],
        ...mocks,
      });

      expect(result).toBeUndefined();
    });

    it("merges both strategy and collector fields together", () => {
      // Create a strategy with VersionedAggregated
      const strategyAggregatedResult = new VersionedAggregated({
        version: 1,
        fields: { errorCount: aggregatedCounter({}) },
      });

      // Create a collector with VersionedAggregated
      const collectorAggregatedResult = new VersionedAggregated({
        version: 1,
        fields: { cpuUsage: aggregatedAverage({}) },
      });

      const mockRegistry: HealthCheckRegistry = {
        getStrategy: mock(() => ({
          id: "test-strategy",
          displayName: "Test",
          description: "Test",
          config: { version: 1 } as never,
          result: { version: 1 } as never,
          aggregatedResult: strategyAggregatedResult,
          createClient: mock() as never,
          mergeResult: mock() as never,
        })),
        register: mock(() => {}),
        getStrategies: mock(() => []),
        getStrategiesWithMeta: mock(() => []),
      };

      const mockCollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock((id: string) => {
          if (id === "test-collector") {
            return {
              collector: {
                id: "test-collector",
                displayName: "Test Collector",
                description: "Test",
                result: { version: 1 },
                aggregatedResult: collectorAggregatedResult,
                mergeResult: mock(),
              },
              qualifiedId: "test-plugin.test-collector",
              ownerPlugin: "test-plugin",
              pluginId: "test-plugin",
            };
          }
          return undefined;
        }),
        getCollectors: mock(() => []),
        getCollectorsForPlugin: mock(() => []),
      } as unknown as CollectorRegistry;

      // Two buckets with both strategy and collector data
      const bucket1 = {
        errorCount: { count: 2 },
        collectors: {
          "uuid-1": {
            _collectorId: "test-collector",
            cpuUsage: { _sum: 50, _count: 5, avg: 10 },
          },
        },
      };

      const bucket2 = {
        errorCount: { count: 3 },
        collectors: {
          "uuid-1": {
            _collectorId: "test-collector",
            cpuUsage: { _sum: 100, _count: 10, avg: 10 },
          },
        },
      };

      const result = mergeAggregatedBucketResults({
        aggregatedResults: [bucket1, bucket2],
        collectorRegistry: mockCollectorRegistry,
        registry: mockRegistry,
        strategyId: "test-strategy",
      });

      expect(result).toBeDefined();
      const typedResult = result as Record<string, unknown>;

      // Strategy-level field merged
      expect(typedResult.errorCount).toEqual({ _type: "counter", count: 5 });

      // Collector-level field merged
      const collectors = typedResult.collectors as Record<
        string,
        Record<string, unknown>
      >;
      expect(collectors["uuid-1"]._collectorId).toBe("test-collector");
      const cpuUsage = collectors["uuid-1"].cpuUsage as Record<string, number>;
      expect(cpuUsage._sum).toBe(150);
      expect(cpuUsage._count).toBe(15);
    });

    it("falls back to preserving first result when strategy not found", () => {
      const mockRegistry: HealthCheckRegistry = {
        getStrategy: mock(() => undefined), // Strategy not found
        register: mock(() => {}),
        getStrategies: mock(() => []),
        getStrategiesWithMeta: mock(() => []),
      };

      const mockCollectorRegistry: CollectorRegistry = {
        register: mock(() => {}),
        getCollector: mock(() => undefined),
        getCollectors: mock(() => []),
        getCollectorsForPlugin: mock(() => []),
      };

      const bucket1 = { errorCount: { count: 5 } };
      const bucket2 = { errorCount: { count: 3 } };

      const result = mergeAggregatedBucketResults({
        aggregatedResults: [bucket1, bucket2],
        collectorRegistry: mockCollectorRegistry,
        registry: mockRegistry,
        strategyId: "unknown-strategy",
      });

      // Should preserve the first bucket's strategy fields (fallback behavior)
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).errorCount).toEqual({
        count: 5,
      });
    });
  });
});
