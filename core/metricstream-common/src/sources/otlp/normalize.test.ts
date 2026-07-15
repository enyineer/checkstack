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

  const VALID_TRACE = "a".repeat(32);
  const VALID_SPAN = "b".repeat(16);

  it("attaches a valid exemplar (32-hex trace id) with its own value + ts", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "cpu",
            data: {
              kind: "gauge",
              points: [
                {
                  attributes: {},
                  timeUnixNano: T_NANOS,
                  value: 0.5,
                  exemplars: [
                    {
                      timeUnixNano: T_NANOS,
                      value: 0.9,
                      traceId: VALID_TRACE,
                      spanId: VALID_SPAN,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].exemplars).toEqual([
      {
        traceId: VALID_TRACE,
        spanId: VALID_SPAN,
        value: 0.9,
        ts: new Date(Number(T_NANOS / 1_000_000n)),
      },
    ]);
  });

  it("drops exemplars whose trace id is not 32-hex or is all-zero", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "cpu",
            data: {
              kind: "gauge",
              points: [
                {
                  attributes: {},
                  timeUnixNano: T_NANOS,
                  value: 1,
                  exemplars: [
                    { timeUnixNano: T_NANOS, value: 1, traceId: "abc", spanId: "" },
                    { timeUnixNano: T_NANOS, value: 1, traceId: "0".repeat(32), spanId: "" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].exemplars).toBeUndefined();
  });

  it("omits a zero/short span id but keeps the exemplar", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "cpu",
            data: {
              kind: "gauge",
              points: [
                {
                  attributes: {},
                  timeUnixNano: T_NANOS,
                  value: 1,
                  exemplars: [
                    { timeUnixNano: T_NANOS, value: 1, traceId: VALID_TRACE, spanId: "0".repeat(16) },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(datapoints[0].exemplars).toHaveLength(1);
    expect(datapoints[0].exemplars?.[0].spanId).toBeUndefined();
  });

  it("caps exemplars to MAX_EXEMPLARS_PER_POINT keeping the newest by ts", () => {
    const points = Array.from({ length: 6 }, (_, i) => ({
      timeUnixNano: BigInt(1_000 + i) * 1_000_000n, // ascending ts by index
      value: i,
      // A distinct, valid (non-zero) 32-hex trace id per exemplar.
      traceId: (i + 1).toString(16).repeat(32).slice(0, 32),
      spanId: "",
    }));
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "cpu",
            data: {
              kind: "gauge",
              points: [{ attributes: {}, timeUnixNano: 0n, value: 1, exemplars: points }],
            },
          },
        ],
      },
    ]);
    const ex = datapoints[0].exemplars ?? [];
    expect(ex).toHaveLength(4);
    // Newest first: the three highest-index (latest ts) exemplars are kept.
    expect(ex.map((e) => e.value)).toEqual([5, 4, 3, 2]);
  });

  it("only the histogram _count series carries the exemplar (not _sum)", () => {
    const { datapoints } = normalize([
      {
        resource: {},
        metrics: [
          {
            name: "latency",
            data: {
              kind: "histogram",
              temporality: AGGREGATION_TEMPORALITY.CUMULATIVE,
              points: [
                {
                  attributes: {},
                  timeUnixNano: T_NANOS,
                  count: 10,
                  sum: 42,
                  exemplars: [
                    { timeUnixNano: T_NANOS, value: 5, traceId: VALID_TRACE, spanId: "" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    const byName = new Map(datapoints.map((d) => [d.name, d]));
    expect(byName.get("latency_count")?.exemplars).toHaveLength(1);
    expect(byName.get("latency_sum")?.exemplars).toBeUndefined();
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
