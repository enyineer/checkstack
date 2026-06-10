import { describe, test, expect } from "bun:test";
import { summarizeRuns, type StatRun } from "./run-stats.logic";

const start = new Date("2026-06-10T00:00:00.000Z");
const end = new Date("2026-06-10T04:00:00.000Z"); // 4h window

function at(hoursFromStart: number, status: string, latencyMs?: number): StatRun {
  return {
    timestamp: new Date(start.getTime() + hoursFromStart * 3_600_000),
    status,
    latencyMs,
  };
}

describe("summarizeRuns", () => {
  test("computes window totals with exact uptime and latency stats", () => {
    const runs: StatRun[] = [
      at(0, "healthy", 100),
      at(0.5, "unhealthy", 300),
      at(1, "healthy", 200),
      at(2, "degraded", 400),
    ];
    const stats = summarizeRuns({ runs, startDate: start, endDate: end, maxBuckets: 4 });
    expect(stats.total.runCount).toBe(4);
    expect(stats.total.healthy).toBe(2);
    expect(stats.total.degraded).toBe(1);
    expect(stats.total.unhealthy).toBe(1);
    expect(stats.total.uptimePct).toBe(50);
    expect(stats.total.minLatencyMs).toBe(100);
    expect(stats.total.maxLatencyMs).toBe(400);
    expect(stats.total.avgLatencyMs).toBe(250);
    expect(stats.window.start).toBe("2026-06-10T00:00:00.000Z");
    expect(stats.window.end).toBe("2026-06-10T04:00:00.000Z");
  });

  test("buckets runs over the window and caps the count", () => {
    const runs: StatRun[] = [
      at(0, "healthy"),
      at(0.5, "unhealthy"),
      at(1, "healthy"),
      at(2, "healthy"),
    ];
    const stats = summarizeRuns({ runs, startDate: start, endDate: end, maxBuckets: 4 });
    // 4h / 4 buckets = 1h interval.
    expect(stats.bucketIntervalSeconds).toBe(3600);
    // Buckets 0 (2 runs), 1 (1 run), 2 (1 run); bucket 3 empty -> omitted.
    expect(stats.buckets).toHaveLength(3);
    expect(stats.buckets[0].runCount).toBe(2);
    expect(stats.buckets[0].healthy).toBe(1);
    expect(stats.buckets[0].unhealthy).toBe(1);
    expect(stats.buckets[0].uptimePct).toBe(50);
    expect(stats.buckets[0].start).toBe("2026-06-10T00:00:00.000Z");
    expect(stats.buckets[0].end).toBe("2026-06-10T01:00:00.000Z");
    // Empty buckets are omitted, not padded.
    expect(stats.buckets.map((b) => b.runCount)).toEqual([2, 1, 1]);
  });

  test("never emits more buckets than maxBuckets", () => {
    const runs: StatRun[] = Array.from({ length: 200 }, (_, i) =>
      at((i / 200) * 4, "healthy"),
    );
    const stats = summarizeRuns({ runs, startDate: start, endDate: end, maxBuckets: 6 });
    expect(stats.buckets.length).toBeLessThanOrEqual(6);
  });

  test("empty window yields zeroed totals and no buckets", () => {
    const stats = summarizeRuns({ runs: [], startDate: start, endDate: end, maxBuckets: 4 });
    expect(stats.total.runCount).toBe(0);
    expect(stats.total.uptimePct).toBe(0);
    expect(stats.total.avgLatencyMs).toBeUndefined();
    expect(stats.buckets).toHaveLength(0);
  });
});
