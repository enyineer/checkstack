import { describe, expect, test } from "bun:test";
import {
  bucketAvgLatencyMs,
  bucketHealthyPercent,
  countHealthy,
  pausedToTone,
  statusToLabel,
  statusToTone,
} from "./healthcheckDisplay.logic";

describe("statusToTone", () => {
  test("maps the triad: healthy=ok, degraded=warn, unhealthy=down", () => {
    expect(statusToTone({ status: "healthy" })).toBe("ok");
    expect(statusToTone({ status: "degraded" })).toBe("warn");
    expect(statusToTone({ status: "unhealthy" })).toBe("down");
  });
});

describe("statusToLabel", () => {
  test("returns capitalized human labels", () => {
    expect(statusToLabel({ status: "healthy" })).toBe("Healthy");
    expect(statusToLabel({ status: "degraded" })).toBe("Degraded");
    expect(statusToLabel({ status: "unhealthy" })).toBe("Unhealthy");
  });
});

describe("pausedToTone", () => {
  test("active is ok, paused is unknown", () => {
    expect(pausedToTone({ paused: false })).toBe("ok");
    expect(pausedToTone({ paused: true })).toBe("unknown");
  });
});

describe("countHealthy", () => {
  test("counts only healthy entries", () => {
    expect(
      countHealthy({ history: ["healthy", "degraded", "healthy", "unhealthy"] }),
    ).toBe(2);
  });

  test("empty history is zero", () => {
    expect(countHealthy({ history: [] })).toBe(0);
  });
});

describe("bucketHealthyPercent", () => {
  test("null when there are no runs at all", () => {
    expect(bucketHealthyPercent({ buckets: [] })).toBeNull();
    expect(
      bucketHealthyPercent({ buckets: [{ healthyCount: 0, runCount: 0 }] }),
    ).toBeNull();
  });

  test("ratio of healthy runs over total runs, rounded", () => {
    expect(
      bucketHealthyPercent({
        buckets: [
          { healthyCount: 9, runCount: 10 },
          { healthyCount: 0, runCount: 0 },
        ],
      }),
    ).toBe(90);
  });

  test("rounds to the nearest whole percent", () => {
    expect(
      bucketHealthyPercent({
        buckets: [{ healthyCount: 1, runCount: 3 }],
      }),
    ).toBe(33);
  });

  test("all healthy is 100", () => {
    expect(
      bucketHealthyPercent({
        buckets: [
          { healthyCount: 5, runCount: 5 },
          { healthyCount: 7, runCount: 7 },
        ],
      }),
    ).toBe(100);
  });
});

describe("bucketAvgLatencyMs", () => {
  test("null when no bucket carries a latency", () => {
    expect(bucketAvgLatencyMs({ buckets: [] })).toBeNull();
    expect(
      bucketAvgLatencyMs({ buckets: [{ healthyCount: 1, runCount: 1 }] }),
    ).toBeNull();
  });

  test("weights each bucket's average by its run count", () => {
    expect(
      bucketAvgLatencyMs({
        buckets: [
          { healthyCount: 1, runCount: 1, avgLatencyMs: 100 },
          { healthyCount: 3, runCount: 3, avgLatencyMs: 200 },
        ],
      }),
    ).toBe(175);
  });

  test("buckets without a latency are skipped", () => {
    expect(
      bucketAvgLatencyMs({
        buckets: [
          { healthyCount: 1, runCount: 1, avgLatencyMs: 50 },
          { healthyCount: 0, runCount: 0 },
        ],
      }),
    ).toBe(50);
  });
});
