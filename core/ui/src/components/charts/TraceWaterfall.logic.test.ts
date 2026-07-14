import { describe, expect, test } from "bun:test";
import {
  buildTraceTree,
  collectParentSpanIds,
  flattenVisibleRows,
  formatSpanDuration,
  serviceColorIndex,
  SERVICE_PALETTE_SIZE,
  toMs,
  type WaterfallSpan,
} from "./TraceWaterfall.logic";

/** Build a span quickly; start is an offset in ms from an arbitrary base. */
const BASE = 1_700_000_000_000;
function span(
  id: string,
  parent: string | null,
  offsetMs: number,
  durationMs: number,
  extra: Partial<WaterfallSpan> = {},
): WaterfallSpan {
  return {
    spanId: id,
    parentSpanId: parent,
    name: `op-${id}`,
    serviceName: "svc",
    kind: "server",
    startTs: BASE + offsetMs,
    durationMs,
    statusCode: "unset",
    ...extra,
  };
}

describe("toMs", () => {
  test("passes numbers through and converts Dates", () => {
    expect(toMs(1234)).toBe(1234);
    expect(toMs(new Date(1234))).toBe(1234);
  });
});

describe("buildTraceTree", () => {
  test("empty input yields an empty tree", () => {
    const tree = buildTraceTree({ spans: [] });
    expect(tree.roots).toHaveLength(0);
    expect(tree.totalMs).toBe(0);
    expect(tree.spanCount).toBe(0);
  });

  test("nests children under parents and orders by start time", () => {
    const spans = [
      span("root", null, 0, 100),
      span("b", "root", 50, 20),
      span("a", "root", 10, 30),
    ];
    const tree = buildTraceTree({ spans });
    expect(tree.roots).toHaveLength(1);
    const root = tree.roots[0]!;
    expect(root.spanId).toBe("root");
    expect(root.children.map((c) => c.spanId)).toEqual(["a", "b"]);
    expect(root.children.every((c) => c.depth === 1)).toBe(true);
    expect(tree.spanCount).toBe(3);
  });

  test("computes the shared time extent and per-span fractions", () => {
    const spans = [
      span("root", null, 0, 100),
      span("child", "root", 50, 50), // ends at 100, the trace end
    ];
    const tree = buildTraceTree({ spans });
    expect(tree.startMs).toBe(BASE);
    expect(tree.endMs).toBe(BASE + 100);
    expect(tree.totalMs).toBe(100);
    const root = tree.roots[0]!;
    expect(root.leftFraction).toBeCloseTo(0);
    expect(root.widthFraction).toBeCloseTo(1);
    const child = root.children[0]!;
    expect(child.leftFraction).toBeCloseTo(0.5);
    expect(child.widthFraction).toBeCloseTo(0.5);
  });

  test("promotes orphans (missing parent) to roots at depth 0", () => {
    const spans = [
      span("orphan", "ghost", 0, 40), // parent "ghost" is absent
      span("root", null, 5, 30),
    ];
    const tree = buildTraceTree({ spans });
    expect(tree.roots.map((r) => r.spanId)).toEqual(["orphan", "root"]);
    expect(tree.roots.every((r) => r.depth === 0)).toBe(true);
  });

  test("width never exceeds the remaining axis (clamped)", () => {
    // A child that starts late but runs long (clock skew) must not overflow.
    const spans = [
      span("root", null, 0, 100),
      span("skewed", "root", 90, 500),
    ];
    const tree = buildTraceTree({ spans });
    const skewed = tree.roots[0]!.children[0]!;
    expect(skewed.leftFraction + skewed.widthFraction).toBeLessThanOrEqual(1.0001);
  });

  test("survives a parent/child cycle without infinite recursion", () => {
    const spans = [
      span("x", "y", 0, 10),
      span("y", "x", 5, 10),
    ];
    const tree = buildTraceTree({ spans });
    // Both spans are placed exactly once.
    expect(tree.spanCount).toBe(2);
    const flat = flattenVisibleRows({ roots: tree.roots, collapsed: new Set() });
    expect(flat).toHaveLength(2);
  });

  test("zero-duration trace does not divide by zero", () => {
    const spans = [span("only", null, 0, 0)];
    const tree = buildTraceTree({ spans });
    expect(tree.totalMs).toBe(0);
    const only = tree.roots[0]!;
    expect(Number.isFinite(only.leftFraction)).toBe(true);
    expect(Number.isFinite(only.widthFraction)).toBe(true);
  });

  test("marks error spans", () => {
    const spans = [span("root", null, 0, 10, { statusCode: "error" })];
    const tree = buildTraceTree({ spans });
    expect(tree.roots[0]!.isError).toBe(true);
  });
});

describe("flattenVisibleRows", () => {
  const spans = [
    span("root", null, 0, 100),
    span("a", "root", 10, 20),
    span("a1", "a", 12, 5),
    span("b", "root", 40, 20),
  ];

  test("pre-order flatten with all expanded", () => {
    const tree = buildTraceTree({ spans });
    const rows = flattenVisibleRows({ roots: tree.roots, collapsed: new Set() });
    expect(rows.map((r) => r.spanId)).toEqual(["root", "a", "a1", "b"]);
    const a = rows.find((r) => r.spanId === "a")!;
    expect(a.hasChildren).toBe(true);
    expect(a.collapsed).toBe(false);
  });

  test("collapsing a node hides its subtree", () => {
    const tree = buildTraceTree({ spans });
    const rows = flattenVisibleRows({
      roots: tree.roots,
      collapsed: new Set(["a"]),
    });
    expect(rows.map((r) => r.spanId)).toEqual(["root", "a", "b"]);
    expect(rows.find((r) => r.spanId === "a")!.collapsed).toBe(true);
  });

  test("collapsing a leaf has no effect (leaf is not collapsible)", () => {
    const tree = buildTraceTree({ spans });
    const rows = flattenVisibleRows({
      roots: tree.roots,
      collapsed: new Set(["b"]),
    });
    expect(rows.map((r) => r.spanId)).toEqual(["root", "a", "a1", "b"]);
    expect(rows.find((r) => r.spanId === "b")!.collapsed).toBe(false);
  });
});

describe("serviceColorIndex", () => {
  test("null/empty names get no color", () => {
    expect(serviceColorIndex(null)).toBeNull();
    expect(serviceColorIndex(undefined)).toBeNull();
    expect(serviceColorIndex("")).toBeNull();
  });

  test("is deterministic and within the palette range", () => {
    const a = serviceColorIndex("checkout");
    const b = serviceColorIndex("checkout");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(SERVICE_PALETTE_SIZE);
  });
});

describe("formatSpanDuration", () => {
  test("renders sub-millisecond, ms, and second scales", () => {
    expect(formatSpanDuration(0)).toBe("0 ms");
    expect(formatSpanDuration(0.4)).toBe("<1 ms");
    expect(formatSpanDuration(342)).toBe("342 ms");
    expect(formatSpanDuration(1400)).toBe("1.40 s");
    expect(formatSpanDuration(23_400)).toBe("23.4 s");
    expect(formatSpanDuration(65_000)).toBe("1m 5s");
  });

  test("seconds rounding carries into minutes (never renders 60s)", () => {
    expect(formatSpanDuration(119_500)).toBe("2m 0s");
    expect(formatSpanDuration(119_400)).toBe("1m 59s");
  });

  test("non-finite / negative durations render as 0 ms", () => {
    expect(formatSpanDuration(Number.NaN)).toBe("0 ms");
    expect(formatSpanDuration(-5)).toBe("0 ms");
  });
});

describe("collectParentSpanIds", () => {
  test("returns only nodes with children", () => {
    const spans = [
      span("root", null, 0, 100),
      span("a", "root", 10, 20),
      span("a1", "a", 12, 5),
      span("b", "root", 40, 20),
    ];
    const tree = buildTraceTree({ spans });
    const parents = collectParentSpanIds({ roots: tree.roots }).toSorted();
    expect(parents).toEqual(["a", "root"]);
  });
});
