import { describe, it, expect } from "bun:test";
import { RateLimiter } from "@checkstack/ingest-utils";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricStreamConfig,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import { admitDatapoints } from "./admit";

const NOW = new Date("2026-07-12T12:00:00.000Z");

function dps(n: number): NormalizedDatapoint[] {
  return Array.from({ length: n }, (_, i) => ({
    name: "m",
    type: "gauge" as const,
    labels: { i: String(i) },
    value: i,
    ts: NOW,
  }));
}

describe("admitDatapoints", () => {
  it("passes a batch within both budgets through untouched", () => {
    const res = admitDatapoints({
      streamId: "s",
      datapoints: dps(5),
      config: DEFAULT_METRIC_STREAM_CONFIG,
      rateLimiter: new RateLimiter(),
      now: NOW,
    });
    expect(res.admitted).toHaveLength(5);
    expect(res.rejectedCap).toBe(0);
    expect(res.rejectedRateLimit).toBe(0);
  });

  it("trims the overflow past the per-request cap", () => {
    const config: MetricStreamConfig = {
      ...DEFAULT_METRIC_STREAM_CONFIG,
      maxDatapointsPerRequest: 3,
    };
    const res = admitDatapoints({
      streamId: "s",
      datapoints: dps(10),
      config,
      rateLimiter: new RateLimiter(),
      now: NOW,
    });
    expect(res.admitted).toHaveLength(3);
    expect(res.rejectedCap).toBe(7);
  });

  it("sheds intake above the soft per-minute rate with a retry-after", () => {
    const config: MetricStreamConfig = {
      ...DEFAULT_METRIC_STREAM_CONFIG,
      softDatapointsPerMinute: 4,
    };
    const rateLimiter = new RateLimiter();
    const first = admitDatapoints({ streamId: "s", datapoints: dps(3), config, rateLimiter, now: NOW });
    expect(first.admitted).toHaveLength(3);
    const second = admitDatapoints({ streamId: "s", datapoints: dps(3), config, rateLimiter, now: NOW });
    expect(second.admitted).toHaveLength(1);
    expect(second.rejectedRateLimit).toBe(2);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });
});
