import { describe, it, expect } from "bun:test";
import { AGGREGATION_TEMPORALITY } from "./decode";
import { parseOtlpMetricsJson } from "./json";

describe("parseOtlpMetricsJson", () => {
  it("parses camelCase OTLP/JSON with string int64 values and enum temporality", () => {
    const payload = parseOtlpMetricsJson({
      resourceMetrics: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "api" } }] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "reqs",
                  sum: {
                    isMonotonic: true,
                    aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    dataPoints: [
                      { attributes: [{ key: "code", value: { stringValue: "200" } }], timeUnixNano: "1700000000000000000", asInt: "42" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(payload).toHaveLength(1);
    expect(payload[0].resource["service.name"]).toBe("api");
    const metric = payload[0].metrics[0];
    expect(metric.data?.kind).toBe("sum");
    if (metric.data?.kind === "sum") {
      expect(metric.data.monotonic).toBe(true);
      expect(metric.data.temporality).toBe(AGGREGATION_TEMPORALITY.CUMULATIVE);
      expect(metric.data.points[0].value).toBe(42);
      expect(metric.data.points[0].timeUnixNano).toBe(1700000000000000000n);
      expect(metric.data.points[0].attributes).toEqual({ code: "200" });
    }
  });

  it("parses snake_case keys and numeric temporality + asDouble", () => {
    const payload = parseOtlpMetricsJson({
      resource_metrics: [
        {
          scope_metrics: [
            {
              metrics: [
                {
                  name: "cpu",
                  gauge: { data_points: [{ time_unix_nano: 0, asDouble: 0.5 }] },
                },
                {
                  name: "lat",
                  histogram: {
                    aggregation_temporality: 1,
                    data_points: [{ count: "5", sum: 12.5 }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const [cpu, lat] = payload[0].metrics;
    expect(cpu.data?.kind).toBe("gauge");
    if (cpu.data?.kind === "gauge") expect(cpu.data.points[0].value).toBe(0.5);
    expect(lat.data?.kind).toBe("histogram");
    if (lat.data?.kind === "histogram") {
      expect(lat.data.temporality).toBe(AGGREGATION_TEMPORALITY.DELTA);
      expect(lat.data.points[0].count).toBe(5);
      expect(lat.data.points[0].sum).toBe(12.5);
    }
  });

  it("returns an empty payload for a non-object body", () => {
    expect(parseOtlpMetricsJson(null)).toEqual([]);
    expect(parseOtlpMetricsJson(42)).toEqual([]);
  });
});
