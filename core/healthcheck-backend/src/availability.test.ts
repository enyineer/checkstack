import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";
import { subDays } from "date-fns";

describe("HealthCheckService.getAvailabilityStats", () => {
  // Mock database
  let mockDb: ReturnType<typeof createMockDb>;
  let service: HealthCheckService;

  // Store mock data for different queries
  let mockDailyAggregates: Array<{
    bucketStart: Date;
    runCount: number;
    healthyCount: number;
  }> = [];
  let mockRawRuns: Array<{
    status: "healthy" | "unhealthy" | "degraded";
    timestamp: Date;
  }> = [];
  let selectCallCount = 0;

  function createMockDb() {
    // Reset call counter on creation
    selectCallCount = 0;

    // Create a mock that handles:
    // 1. First select: daily aggregates
    // 2. Second select: raw runs
    const createSelectChain = () => {
      const currentCall = selectCallCount++;

      return {
        from: mock(() => ({
          where: mock(() => {
            // First call: daily aggregates, Second call: raw runs
            if (currentCall === 0) return Promise.resolve(mockDailyAggregates);
            return Promise.resolve(mockRawRuns);
          }),
        })),
      };
    };

    return {
      select: mock(createSelectChain),
    };
  }

  beforeEach(() => {
    // Reset mock data
    mockDailyAggregates = [];
    mockRawRuns = [];
    mockDb = createMockDb();
    service = new HealthCheckService(mockDb as never);
  });

  describe("with no data", () => {
    it("returns null availability when no aggregates or runs exist", async () => {
      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBeNull();
      expect(result.availability365Days).toBeNull();
      expect(result.totalRuns31Days).toBe(0);
      expect(result.totalRuns365Days).toBe(0);
    });
  });

  describe("with only daily aggregates", () => {
    it("calculates 100% availability when all runs are healthy", async () => {
      const now = new Date();

      mockDailyAggregates = [
        { bucketStart: subDays(now, 10), runCount: 100, healthyCount: 100 },
        { bucketStart: subDays(now, 20), runCount: 100, healthyCount: 100 },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(100);
      expect(result.availability365Days).toBe(100);
      expect(result.totalRuns31Days).toBe(200);
      expect(result.totalRuns365Days).toBe(200);
    });

    it("calculates correct availability with mixed results", async () => {
      const now = new Date();

      mockDailyAggregates = [
        { bucketStart: subDays(now, 10), runCount: 100, healthyCount: 90 }, // 90%
        { bucketStart: subDays(now, 20), runCount: 100, healthyCount: 80 }, // 80%
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // 170 healthy / 200 total = 85%
      expect(result.availability31Days).toBe(85);
      expect(result.availability365Days).toBe(85);
      expect(result.totalRuns31Days).toBe(200);
      expect(result.totalRuns365Days).toBe(200);
    });

    it("separates 31-day and 365-day data correctly", async () => {
      const now = new Date();

      mockDailyAggregates = [
        // Within 31 days
        { bucketStart: subDays(now, 10), runCount: 100, healthyCount: 99 },
        // Outside 31 days, but within 365 days
        { bucketStart: subDays(now, 60), runCount: 100, healthyCount: 50 },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // 31 days: 99/100 = 99%
      expect(result.availability31Days).toBe(99);
      expect(result.totalRuns31Days).toBe(100);

      // 365 days: (99+50)/200 = 74.5%
      expect(result.availability365Days).toBe(74.5);
      expect(result.totalRuns365Days).toBe(200);
    });
  });

  describe("with raw runs (recent data not yet aggregated)", () => {
    it("includes raw runs that are not in any aggregate bucket", async () => {
      const now = new Date();

      // No daily aggregates
      mockDailyAggregates = [];

      // Recent raw runs
      mockRawRuns = [
        { status: "healthy", timestamp: subDays(now, 1) },
        { status: "healthy", timestamp: subDays(now, 2) },
        { status: "unhealthy", timestamp: subDays(now, 3) },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // 2 healthy / 3 total = 66.67%
      expect(result.availability31Days).toBeCloseTo(66.67, 1);
      expect(result.availability365Days).toBeCloseTo(66.67, 1);
      expect(result.totalRuns31Days).toBe(3);
      expect(result.totalRuns365Days).toBe(3);
    });

    it("deduplicates raw runs when aggregate bucket exists", async () => {
      const now = new Date();
      const bucketDate = subDays(now, 5);
      bucketDate.setUTCHours(0, 0, 0, 0);

      // Aggregate bucket for that day
      mockDailyAggregates = [
        { bucketStart: bucketDate, runCount: 10, healthyCount: 9 },
      ];

      // Raw runs on the same day (should be deduplicated)
      const runTimestamp = new Date(bucketDate);
      runTimestamp.setUTCHours(12, 0, 0, 0); // Same day, different time
      mockRawRuns = [
        { status: "healthy", timestamp: runTimestamp },
        { status: "healthy", timestamp: runTimestamp },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // Should only count the aggregate bucket, not the raw runs
      expect(result.totalRuns31Days).toBe(10);
      expect(result.totalRuns365Days).toBe(10);
      expect(result.availability31Days).toBe(90);
    });
  });

  describe("99.9% availability calculation", () => {
    it("calculates precise availability for SLA tracking", async () => {
      const now = new Date();

      // Simulate a month with 1 failure out of 1000 runs
      mockDailyAggregates = [
        { bucketStart: subDays(now, 15), runCount: 1000, healthyCount: 999 },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(99.9);
      expect(result.availability365Days).toBe(99.9);
    });

    it("calculates very high availability correctly", async () => {
      const now = new Date();

      // 99.99% availability
      mockDailyAggregates = [
        { bucketStart: subDays(now, 15), runCount: 10_000, healthyCount: 9999 },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(99.99);
    });
  });
});
