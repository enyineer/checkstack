import { describe, it, expect } from "bun:test";
import type { TraceWindowLatency } from "../storage";
import { buildTraceWindowMetrics, buildOperationLatency } from "./window";

// The complete-minute window math + seconds-since-last helper are covered by
// @checkstack/healthcheck-common's own health-window.test.ts; this file only
// exercises the trace-specific build* assembly over them.
const STREAM_CREATED = new Date("2026-01-01T00:00:00.000Z");

describe("buildTraceWindowMetrics", () => {
  it("assembles span + trace metrics and the per-minute error rate", () => {
    const result = buildTraceWindowMetrics({
      spanTotals: { spanCount: 100, errorSpanCount: 8 },
      traceTotals: { traceCount: 25, errorTraceCount: 4 },
      now: new Date("2026-01-01T12:03:00.000Z"),
      lastReceivedAt: new Date("2026-01-01T12:02:30.000Z"),
      streamCreatedAt: STREAM_CREATED,
      windowMinutes: 5,
    });
    expect(result.spanCount).toBe(100);
    expect(result.traceCount).toBe(25);
    expect(result.errorSpanCount).toBe(8);
    expect(result.errorTraceCount).toBe(4);
    // 8 error spans / 5 minutes = 1.6
    expect(result.errorRatePerMinute).toBe(1.6);
    expect(result.secondsSinceLastSpan).toBe(30);
  });

  it("zeroes cleanly for an empty window (never an error field)", () => {
    const result = buildTraceWindowMetrics({
      spanTotals: { spanCount: 0, errorSpanCount: 0 },
      traceTotals: { traceCount: 0, errorTraceCount: 0 },
      now: new Date("2026-01-01T00:05:00.000Z"),
      lastReceivedAt: null,
      streamCreatedAt: STREAM_CREATED,
      windowMinutes: 5,
    });
    expect(result.spanCount).toBe(0);
    expect(result.errorRatePerMinute).toBe(0);
    // Never received -> counts from creation (00:00 -> 00:05 = 300s).
    expect(result.secondsSinceLastSpan).toBe(300);
  });
});

describe("buildOperationLatency", () => {
  const window = (over: Partial<TraceWindowLatency>): TraceWindowLatency => ({
    spanCount: 0,
    errorCount: 0,
    durSumMs: 0,
    durMinMs: null,
    durMaxMs: null,
    p95Ms: null,
    ...over,
  });

  it("derives p95/avg/max/errorRate from a merged window aggregate", () => {
    const result = buildOperationLatency({
      window: window({
        spanCount: 40,
        errorCount: 2,
        durSumMs: 4000,
        durMinMs: 5,
        durMaxMs: 900,
        p95Ms: 512.4,
      }),
    });
    expect(result.p95Ms).toBe(512.4);
    expect(result.avgMs).toBe(100); // 4000 / 40
    expect(result.maxMs).toBe(900);
    expect(result.spanCount).toBe(40);
    expect(result.errorCount).toBe(2);
    expect(result.errorRate).toBe(0.05); // 2 / 40
  });

  it("reports zeroed values (never null) for an empty window", () => {
    const result = buildOperationLatency({ window: window({}) });
    expect(result.p95Ms).toBe(0);
    expect(result.avgMs).toBe(0);
    expect(result.maxMs).toBe(0);
    expect(result.spanCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.errorRate).toBe(0);
  });
});
