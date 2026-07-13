import { describe, it, expect } from "bun:test";
import { AGGREGATION_TEMPORALITY, type OtlpMetricsPayload } from "./decode";
import { normalizeOtlpMetrics, OTLP_RESOURCE_LABEL_ALLOWLIST } from "./normalize";

const NOW = new Date("2026-07-12T12:00:00.000Z");
const T_NANOS = 1_700_000_000_000_000_000n; // 2023-11-14T...

function normalize(payload: OtlpMetricsPayload) {
  return normalizeOtlpMetrics({ payload, now: NOW });
}

describe("normalizeOtlpMetrics", () => {
  it("maps a gauge to a gauge datapoint and folds allowlisted resource attrs", () => {
    const { datapoints, rejected } = normalize([
      {
        resource: { "service.name": "api", "host.name": "ignored" },
        metrics: [
          {
            name: "cpu",
            unit: "1",
            data: { kind: "gauge", points: [{ attributes: { core: "0" }, timeUnixNano: T_NANOS, value: 0.7 }] },
          },
        ],
      },
    ]);
    expect(rejected).toBe(0);
    expect(datapoints).toHaveLength(1);
    const dp = datapoints[0];
    expect(dp.type).toBe("gauge");
    expect(dp.counterKind).toBeUndefined();
    expect(dp.value).toBe(0.7);
    // service.name folded; host.name (not on the allowlist) dropped; point attr kept.
    expect(dp.labels).toEqual({ "service.name": "api", core: "0" });
    expect(dp.ts.getTime()).toBe(Number(T_NANOS / 1_000_000n));
    expect(OTLP_RESOURCE_LABEL_ALLOWLIST).toContain("service.name");
  });

  it("tags a monotonic cumulative sum as a cumulative counter", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "reqs",
            data: {
              kind: "sum",
              monotonic: true,
              temporality: AGGREGATION_TEMPORALITY.CUMULATIVE,
              points: [{ attributes: {}, timeUnixNano: 0n, value: 100 }],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].type).toBe("counter");
    expect(datapoints[0].counterKind).toBe("cumulative");
    // timeUnixNano 0 -> falls back to receive time.
    expect(datapoints[0].ts.getTime()).toBe(NOW.getTime());
  });

  it("tags a monotonic delta sum as a delta counter", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "reqs",
            data: {
              kind: "sum",
              monotonic: true,
              temporality: AGGREGATION_TEMPORALITY.DELTA,
              points: [{ attributes: {}, timeUnixNano: 0n, value: 5 }],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].counterKind).toBe("delta");
  });

  it("treats a non-monotonic sum (UpDownCounter) as a gauge", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "queue_depth",
            data: {
              kind: "sum",
              monotonic: false,
              temporality: AGGREGATION_TEMPORALITY.CUMULATIVE,
              points: [{ attributes: {}, timeUnixNano: 0n, value: 12 }],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].type).toBe("gauge");
    expect(datapoints[0].counterKind).toBeUndefined();
  });

  it("decomposes a histogram into _count and _sum cumulative counters", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "latency",
            data: {
              kind: "histogram",
              temporality: AGGREGATION_TEMPORALITY.CUMULATIVE,
              points: [{ attributes: { route: "/x" }, timeUnixNano: 0n, count: 10, sum: 42 }],
            },
          },
        ],
      },
    ]);
    const byName = new Map(datapoints.map((d) => [d.name, d]));
    expect(byName.get("latency_count")).toMatchObject({ type: "counter", counterKind: "cumulative", value: 10 });
    expect(byName.get("latency_sum")).toMatchObject({ type: "counter", counterKind: "cumulative", value: 42 });
    // both carry the datapoint's labels.
    expect(byName.get("latency_count")?.labels).toEqual({ route: "/x" });
  });

  it("omits _sum when a histogram datapoint has no sum", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "h",
            data: {
              kind: "histogram",
              temporality: AGGREGATION_TEMPORALITY.CUMULATIVE,
              points: [{ attributes: {}, timeUnixNano: 0n, count: 3 }],
            },
          },
        ],
      },
    ]);
    expect(datapoints.map((d) => d.name)).toEqual(["h_count"]);
  });

  it("decomposes a summary into _count and _sum cumulative counters", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "rpc",
            data: {
              kind: "summary",
              points: [{ attributes: {}, timeUnixNano: 0n, count: 4, sum: 8 }],
            },
          },
        ],
      },
    ]);
    expect(datapoints.map((d) => d.name).toSorted()).toEqual(["rpc_count", "rpc_sum"]);
    expect(datapoints.every((d) => d.type === "counter" && d.counterKind === "cumulative")).toBe(true);
  });

  it("counts datapoints of unsupported / nameless metrics as rejected", () => {
    const { datapoints, rejected } = normalize([
      {
        resource: {},
        metrics: [
          { name: "", data: { kind: "gauge", points: [{ attributes: {}, timeUnixNano: 0n, value: 1 }] } },
          { name: "unsupported", data: undefined },
        ],
      },
    ]);
    expect(datapoints).toHaveLength(0);
    expect(rejected).toBe(1); // the nameless gauge's single point; the dataless metric has 0 points
  });
});
