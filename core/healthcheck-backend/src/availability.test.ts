import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";
import { subDays, subHours } from "date-fns";

describe("HealthCheckService.getAvailabilityStats", () => {
  // Mock database
  let mockDb: ReturnType<typeof createMockDb>;
  let service: HealthCheckService;

  // Store mock data for different queries
  let mockHourlyAggregates: Array<{
    bucketStart: Date;
    runCount: number;
    healthyCount: number;
  }> = [];
  let mockDailyAggregates: Array<{
    bucketStart: Date;
    runCount: number;
    healthyCount: number;
  }> = [];
  let mockRetentionConfig: { retentionConfig: unknown } | undefined = undefined;

  function createMockDb() {
    // Select call order for getAvailabilityStats:
    // 1. getRetentionConfig (from systemHealthChecks) - uses .then() pattern
    // 2. hourlyAggregates
    // 3. dailyAggregates
    let selectCallCount = 0;

    const createSelectChain = () => {
      const currentCall = selectCallCount++;

      return {
        from: mock(() => ({
          where: mock(() => {
            // Call 0: retentionConfig - uses .then() pattern
            if (currentCall === 0) {
              const result = mockRetentionConfig ? [mockRetentionConfig] : [];
              // Return a promise-like object with .then()
              return Promise.resolve(result);
            }
            // Call 1: hourly aggregates
            if (currentCall === 1) return Promise.resolve(mockHourlyAggregates);
            // Call 2: daily aggregates
            return Promise.resolve(mockDailyAggregates);
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
    mockHourlyAggregates = [];
    mockDailyAggregates = [];
    mockRetentionConfig = undefined;
    mockDb = createMockDb();
    service = new HealthCheckService(mockDb as never, {} as never, {} as never);
  });

  describe("with no data", () => {
    it("returns null availability when no aggregates exist", async () => {
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

  describe("with hourly aggregates (real-time incremental)", () => {
    it("calculates 100% availability when all runs are healthy", async () => {
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 2),
          runCount: 100,
          healthyCount: 100,
        },
        {
          bucketStart: subHours(new Date(), 5),
          runCount: 100,
          healthyCount: 100,
        },
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
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 2),
          runCount: 100,
          healthyCount: 90,
        },
        {
          bucketStart: subHours(new Date(), 5),
          runCount: 100,
          healthyCount: 80,
        },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // 170 healthy / 200 total = 85%
      expect(result.availability31Days).toBe(85);
      expect(result.availability365Days).toBe(85);
    });

    it("includes current hour data since aggregates are updated incrementally", async () => {
      const currentHourStart = new Date();
      currentHourStart.setMinutes(0, 0, 0);

      mockHourlyAggregates = [
        { bucketStart: currentHourStart, runCount: 10, healthyCount: 9 },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.totalRuns31Days).toBe(10);
      expect(result.availability31Days).toBe(90);
    });
  });

  describe("with combined hourly and daily aggregates", () => {
    it("combines hourly and daily data correctly", async () => {
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 2),
          runCount: 100,
          healthyCount: 99,
        },
      ];

      mockDailyAggregates = [
        {
          bucketStart: subDays(new Date(), 60),
          runCount: 100,
          healthyCount: 50,
        },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      // 31 days: only hourly (99/100) = 99%
      expect(result.availability31Days).toBe(99);
      expect(result.totalRuns31Days).toBe(100);

      // 365 days: (99+50)/200 = 74.5%
      expect(result.availability365Days).toBe(74.5);
      expect(result.totalRuns365Days).toBe(200);
    });
  });

  describe("99.9% availability calculation", () => {
    it("calculates precise availability for SLA tracking", async () => {
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 5),
          runCount: 1000,
          healthyCount: 999,
        },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(99.9);
      expect(result.availability365Days).toBe(99.9);
    });

    it("calculates very high availability correctly", async () => {
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 5),
          runCount: 10_000,
          healthyCount: 9999,
        },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(99.99);
    });
  });

  describe("real-time incremental aggregation behavior", () => {
    it("uses hourly aggregates directly without raw run queries", async () => {
      mockHourlyAggregates = [
        {
          bucketStart: subHours(new Date(), 1),
          runCount: 50,
          healthyCount: 48,
        },
      ];

      const result = await service.getAvailabilityStats({
        systemId: "sys-1",
        configurationId: "config-1",
      });

      expect(result.availability31Days).toBe(96);
      expect(result.totalRuns31Days).toBe(50);
    });
  });
});
