import { describe, it, expect } from "bun:test";
import {
  MetricStreamConfigSchema,
  DEFAULT_METRIC_STREAM_CONFIG,
  MetricWindowCollectorConfigSchema,
  NormalizedDatapointSchema,
  MetricStreamSummarySchema,
  LabelFilterSchema,
} from "./schemas";

describe("MetricStreamConfigSchema", () => {
  it("applies the plan's defaults for an empty object", () => {
    expect(DEFAULT_METRIC_STREAM_CONFIG).toEqual({
      seriesCap: 5_000,
      minuteRetentionHours: 48,
      hourlyRetentionDays: 90,
      softDatapointsPerMinute: 60_000,
      maxDatapointsPerRequest: 10_000,
    });
  });

  it("rejects a seriesCap below the floor", () => {
    expect(MetricStreamConfigSchema.safeParse({ seriesCap: 1 }).success).toBe(
      false,
    );
  });
});

describe("MetricWindowCollectorConfigSchema", () => {
  it("defaults labelFilters to an empty array", () => {
    const parsed = MetricWindowCollectorConfigSchema.parse({
      metricName: "http_requests_total",
    });
    expect(parsed.labelFilters).toEqual([]);
    expect(parsed.windowSeconds).toBeUndefined();
  });

  it("accepts exact-match label filters", () => {
    const parsed = MetricWindowCollectorConfigSchema.parse({
      metricName: "http_requests_total",
      labelFilters: [
        { key: "method", value: "GET" },
        { key: "code", value: "200" },
      ],
      windowSeconds: 300,
    });
    expect(parsed.labelFilters).toHaveLength(2);
  });

  it("rejects an empty metric name", () => {
    expect(
      MetricWindowCollectorConfigSchema.safeParse({ metricName: "" }).success,
    ).toBe(false);
  });
});

describe("LabelFilterSchema", () => {
  it("allows an empty value but not an empty key", () => {
    expect(LabelFilterSchema.safeParse({ key: "k", value: "" }).success).toBe(
      true,
    );
    expect(LabelFilterSchema.safeParse({ key: "", value: "v" }).success).toBe(
      false,
    );
  });
});

describe("NormalizedDatapointSchema", () => {
  it("parses a gauge datapoint without counterKind", () => {
    const parsed = NormalizedDatapointSchema.parse({
      name: "cpu_usage",
      type: "gauge",
      labels: { host: "a" },
      value: 0.42,
      ts: new Date(),
    });
    expect(parsed.counterKind).toBeUndefined();
  });

  it("parses a cumulative counter datapoint", () => {
    const parsed = NormalizedDatapointSchema.parse({
      name: "requests_total",
      type: "counter",
      counterKind: "cumulative",
      labels: {},
      value: 1234,
      ts: new Date(),
    });
    expect(parsed.counterKind).toBe("cumulative");
  });
});

describe("MetricStreamSummarySchema", () => {
  it("keys on `id` (the RLAC listKey lesson)", () => {
    const parsed = MetricStreamSummarySchema.parse({
      id: "stream-1",
      lastReceivedAt: null,
      approxDatapointsPerMinute: 0,
      seriesCount: 0,
      seriesCap: 5_000,
      droppedSeriesCount: 0,
    });
    expect(parsed.id).toBe("stream-1");
  });
});
