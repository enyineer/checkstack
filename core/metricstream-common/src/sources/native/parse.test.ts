import { describe, it, expect } from "bun:test";
import { parseNativeMetricsBody } from "./parse";

const NOW = new Date("2026-07-12T12:00:00.000Z");

function parse(text: string, ndjson = false) {
  return parseNativeMetricsBody({ text, ndjson, now: NOW });
}

describe("parseNativeMetricsBody", () => {
  it("parses a JSON array, defaulting type to gauge and ts to now", () => {
    const { datapoints, rejected } = parse(
      JSON.stringify([{ name: "cpu", value: 0.5, labels: { host: "a" } }]),
    );
    expect(rejected).toBe(0);
    expect(datapoints[0]).toMatchObject({ name: "cpu", type: "gauge", value: 0.5, labels: { host: "a" } });
    expect(datapoints[0].ts.getTime()).toBe(NOW.getTime());
    expect(datapoints[0].counterKind).toBeUndefined();
  });

  it("defaults a counter's kind to cumulative and honors an explicit delta", () => {
    const { datapoints } = parse(
      JSON.stringify([
        { name: "reqs", type: "counter", value: 100 },
        { name: "d", type: "counter", counterKind: "delta", value: 3 },
      ]),
    );
    expect(datapoints[0]).toMatchObject({ type: "counter", counterKind: "cumulative" });
    expect(datapoints[1]).toMatchObject({ type: "counter", counterKind: "delta" });
  });

  it("accepts a { metrics: [...] } envelope and ISO / epoch timestamps", () => {
    const iso = "2026-07-12T11:59:00.000Z";
    const { datapoints } = parse(
      JSON.stringify({
        metrics: [
          { name: "a", value: 1, ts: iso },
          { name: "b", value: 2, ts: 1_700_000_000_000 },
        ],
      }),
    );
    expect(datapoints[0].ts.toISOString()).toBe(iso);
    expect(datapoints[1].ts.getTime()).toBe(1_700_000_000_000);
  });

  it("coerces numeric/boolean label values to strings", () => {
    const { datapoints } = parse(JSON.stringify([{ name: "m", value: 1, labels: { n: 5, ok: true } }]));
    expect(datapoints[0].labels).toEqual({ n: "5", ok: "true" });
  });

  it("rejects records missing name or value, keeps the rest", () => {
    const { datapoints, rejected } = parse(
      JSON.stringify([{ value: 1 }, { name: "ok", value: 2 }, { name: "x" }]),
    );
    expect(datapoints).toHaveLength(1);
    expect(datapoints[0].name).toBe("ok");
    expect(rejected).toBe(2);
  });

  it("parses NDJSON, counting malformed lines as rejected", () => {
    const { datapoints, rejected } = parse(
      `{"name":"a","value":1}\nnot json\n{"name":"b","value":2}`,
      true,
    );
    expect(datapoints.map((d) => d.name)).toEqual(["a", "b"]);
    expect(rejected).toBe(1);
  });

  it("treats a wholly-unparseable JSON body as one rejected record", () => {
    expect(parse("<<<").rejected).toBe(1);
    expect(parse("<<<").datapoints).toHaveLength(0);
  });
});
