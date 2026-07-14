import { describe, expect, it } from "bun:test";
import type { TraceSummary } from "@checkstack/tracestream-common";
import {
  defaultTraceRange,
  effectiveTraceRange,
  EMPTY_TRACE_FILTERS,
  hasActiveTraceFilters,
  maxTraceDuration,
  mergeOlderTraces,
  parseDurationInput,
  toTraceSearchInput,
} from "./trace-search";

function summary(traceId: string, durationMs: number): TraceSummary {
  return {
    traceId,
    rootServiceName: "api",
    rootSpanName: "GET /",
    startTs: new Date(1_700_000_000_000),
    durationMs,
    spanCount: 3,
    errorSpanCount: 0,
    hasError: false,
    retained: true,
    lastSpanAt: new Date(1_700_000_000_100),
  };
}

describe("hasActiveTraceFilters", () => {
  it("is false for the empty filters", () => {
    expect(hasActiveTraceFilters(EMPTY_TRACE_FILTERS)).toBe(false);
  });
  it("is true when a facet is set", () => {
    expect(
      hasActiveTraceFilters({ ...EMPTY_TRACE_FILTERS, serviceName: "api" }),
    ).toBe(true);
    expect(
      hasActiveTraceFilters({ ...EMPTY_TRACE_FILTERS, status: "error" }),
    ).toBe(true);
  });
  it("ignores a blank traceId", () => {
    expect(
      hasActiveTraceFilters({ ...EMPTY_TRACE_FILTERS, traceId: "   " }),
    ).toBe(false);
  });
});

describe("defaultTraceRange / effectiveTraceRange", () => {
  it("quantizes the fallback end up to the minute", () => {
    const now = 1_700_000_000_123;
    const { endDate, startDate } = defaultTraceRange({ now });
    expect(endDate.getTime() % 60_000).toBe(0);
    expect(endDate.getTime() - startDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });
  it("prefers the explicit window when both bounds are set", () => {
    const from = new Date(1000);
    const to = new Date(2000);
    expect(effectiveTraceRange({ from, to })).toEqual({
      startDate: from,
      endDate: to,
    });
  });
  it("falls back when only one bound is set", () => {
    const now = 1_700_000_000_000;
    const range = effectiveTraceRange({ from: new Date(1000), to: null, now });
    expect(range).toEqual(defaultTraceRange({ now }));
  });
});

describe("toTraceSearchInput", () => {
  const range = { startDate: new Date(1000), endDate: new Date(2000) };

  it("always carries streamId + window and defaults the limit", () => {
    const input = toTraceSearchInput({
      streamId: "s1",
      filters: EMPTY_TRACE_FILTERS,
      range,
    });
    expect(input.streamId).toBe("s1");
    expect(input.from).toEqual(range.startDate);
    expect(input.to).toEqual(range.endDate);
    expect(input.limit).toBe(50);
    expect(input.serviceName).toBeUndefined();
    expect(input.status).toBeUndefined();
  });

  it("forwards only the set facets and a trimmed traceId", () => {
    const input = toTraceSearchInput({
      streamId: "s1",
      filters: {
        ...EMPTY_TRACE_FILTERS,
        serviceName: "checkout",
        status: "error",
        minDurationMs: 100,
        traceId: "  abc  ",
      },
      range,
      cursor: { startTs: new Date(1500), traceId: "z" },
      limit: 25,
    });
    expect(input.serviceName).toBe("checkout");
    expect(input.status).toBe("error");
    expect(input.minDurationMs).toBe(100);
    expect(input.traceId).toBe("abc");
    expect(input.cursor?.traceId).toBe("z");
    expect(input.limit).toBe(25);
  });
});

describe("mergeOlderTraces", () => {
  it("appends older traces and dedupes by traceId", () => {
    const current = [summary("a", 10), summary("b", 20)];
    const incoming = [summary("b", 20), summary("c", 30)];
    const merged = mergeOlderTraces({ current, incoming });
    expect(merged.map((t) => t.traceId)).toEqual(["a", "b", "c"]);
  });
});

describe("maxTraceDuration", () => {
  it("returns the largest duration, or 0 when empty", () => {
    expect(maxTraceDuration([summary("a", 10), summary("b", 42)])).toBe(42);
    expect(maxTraceDuration([])).toBe(0);
  });
});

describe("parseDurationInput", () => {
  it("parses non-negative numbers, else null", () => {
    expect(parseDurationInput("250")).toBe(250);
    expect(parseDurationInput("  ")).toBeNull();
    expect(parseDurationInput("-5")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
  });
});
