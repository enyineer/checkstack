import { describe, it, expect } from "bun:test";
import type { NormalizedDatapoint } from "@checkstack/metricstream-common";
import { parsePrometheusText, parseSampleLine } from "./text-parse";

const NOW = new Date("2026-07-12T12:00:00.000Z");

function parse(text: string): NormalizedDatapoint[] {
  return parsePrometheusText({ text, now: NOW }).datapoints;
}

/** Sort datapoints deterministically for assertion. */
function byName(dps: NormalizedDatapoint[]): NormalizedDatapoint[] {
  return dps.toSorted((a, b) => a.name.localeCompare(b.name));
}

describe("parsePrometheusText - table-driven fixtures", () => {
  const cases: {
    name: string;
    text: string;
    expect: Array<Partial<NormalizedDatapoint>>;
  }[] = [
    {
      name: "counter",
      text: `# TYPE http_requests_total counter\nhttp_requests_total{method="get"} 1027`,
      expect: [
        { name: "http_requests_total", type: "counter", counterKind: "cumulative", value: 1027, labels: { method: "get" } },
      ],
    },
    {
      name: "gauge",
      text: `# TYPE temperature gauge\ntemperature 21.3`,
      expect: [{ name: "temperature", type: "gauge", value: 21.3, labels: {} }],
    },
    {
      name: "untyped -> gauge",
      text: `# TYPE thing untyped\nthing 5`,
      expect: [{ name: "thing", type: "gauge", value: 5 }],
    },
    {
      name: "no TYPE declared -> gauge",
      text: `mystery_metric 9`,
      expect: [{ name: "mystery_metric", type: "gauge", value: 9 }],
    },
    {
      name: "histogram: buckets dropped, _sum/_count kept as counters",
      text: [
        `# TYPE request_duration histogram`,
        `request_duration_bucket{le="0.1"} 5`,
        `request_duration_bucket{le="0.5"} 8`,
        `request_duration_bucket{le="+Inf"} 10`,
        `request_duration_sum 4.2`,
        `request_duration_count 10`,
      ].join("\n"),
      expect: [
        { name: "request_duration_count", type: "counter", counterKind: "cumulative", value: 10 },
        { name: "request_duration_sum", type: "counter", counterKind: "cumulative", value: 4.2 },
      ],
    },
    {
      name: "summary: quantiles dropped, _sum/_count kept as counters",
      text: [
        `# TYPE rpc_duration summary`,
        `rpc_duration{quantile="0.5"} 0.05`,
        `rpc_duration{quantile="0.99"} 0.2`,
        `rpc_duration_sum 1.7`,
        `rpc_duration_count 20`,
      ].join("\n"),
      expect: [
        { name: "rpc_duration_count", type: "counter", value: 20 },
        { name: "rpc_duration_sum", type: "counter", value: 1.7 },
      ],
    },
    {
      name: "escaped label values",
      text: `# TYPE msg gauge\nmsg{text="line1\\nline2",path="a\\\\b",q="say \\"hi\\""} 1`,
      expect: [
        { name: "msg", labels: { text: "line1\nline2", path: "a\\b", q: 'say "hi"' }, value: 1 },
      ],
    },
    {
      name: "HELP lines and comments are ignored",
      text: `# HELP foo the foo metric\n# a stray comment\n# TYPE foo counter\nfoo 3`,
      expect: [{ name: "foo", type: "counter", value: 3 }],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const got = byName(parse(c.text));
      const want = c.expect.toSorted((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      expect(got).toHaveLength(want.length);
      got.forEach((dp, i) => expect(dp).toMatchObject(want[i]));
    });
  }

  it("honors an explicit sample timestamp (epoch millis)", () => {
    const dps = parse(`# TYPE g gauge\ng 5 1700000000000`);
    expect(dps[0].ts.getTime()).toBe(1_700_000_000_000);
  });

  it("uses receive time when no timestamp is present", () => {
    const dps = parse(`# TYPE g gauge\ng 5`);
    expect(dps[0].ts.getTime()).toBe(NOW.getTime());
  });

  it("drops a malformed exemplar (short trace id) without corrupting the sample", () => {
    const dps = parse(`# TYPE c counter\nc_total{le="0.1"} 8 # {trace_id="abc"} 1.0 1700000000`);
    // trace_id "abc" is not 32-hex, so the exemplar is dropped; the sample after
    // ` # ` must still parse cleanly.
    expect(dps).toHaveLength(1);
    expect(dps[0].value).toBe(8);
    expect(dps[0].labels).toEqual({ le: "0.1" });
    expect(dps[0].exemplars).toBeUndefined();
  });

  it("parses a valid OpenMetrics exemplar into the datapoint (ts in seconds)", () => {
    const trace = "a".repeat(32);
    const span = "b".repeat(16);
    const dps = parse(
      `# TYPE c counter\nc_total 8 # {trace_id="${trace}",span_id="${span}"} 3 1700000000.5`,
    );
    expect(dps[0].exemplars).toEqual([
      {
        traceId: trace,
        spanId: span,
        value: 3,
        // 1700000000.5 seconds -> 1700000000500 ms.
        ts: new Date(1_700_000_000_500),
      },
    ]);
  });

  it("falls back to the sample ts for an exemplar without its own timestamp", () => {
    const trace = "c".repeat(32);
    const dps = parse(`# TYPE c counter\nc_total 8 1700000000000 # {trace_id="${trace}"} 3`);
    expect(dps[0].exemplars?.[0].ts.getTime()).toBe(1_700_000_000_000);
  });

  it("skips non-finite sample values (NaN / Inf) so aggregates stay clean", () => {
    const dps = parse(`# TYPE g gauge\ng_a NaN\ng_b +Inf\ng_c 1`);
    expect(dps.map((d) => d.name)).toEqual(["g_c"]);
  });

  it("reports the distinct series count", () => {
    const result = parsePrometheusText({
      text: `# TYPE g gauge\ng{h="a"} 1\ng{h="b"} 2\ng{h="a"} 3`,
      now: NOW,
    });
    expect(result.seriesCount).toBe(2);
  });
});

describe("parseSampleLine", () => {
  it("parses name, labels, value with no timestamp", () => {
    expect(parseSampleLine(`m{a="1",b="2"} 3.5`)).toEqual({
      name: "m",
      labels: { a: "1", b: "2" },
      value: 3.5,
      tsMillis: undefined,
    });
  });

  it("tolerates a trailing comma and whitespace in the label block", () => {
    expect(parseSampleLine(`m{ a="1", } 2`)?.labels).toEqual({ a: "1" });
  });

  it("returns null for a malformed line", () => {
    expect(parseSampleLine(`{no="name"} 1`)).toBeNull();
    expect(parseSampleLine(`m{unterminated="`)).toBeNull();
  });
});
