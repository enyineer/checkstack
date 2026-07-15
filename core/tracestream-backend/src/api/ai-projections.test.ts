import { describe, it, expect } from "bun:test";
import {
  projectGetTraceForModel,
  projectSearchTracesForModel,
} from "./ai-projections";

const summary = {
  traceId: "trace-1",
  rootServiceName: "gateway",
  rootSpanName: "GET /pay",
  startTs: new Date("2026-07-14T10:00:00.000Z"),
  durationMs: 42,
  spanCount: 2,
  errorSpanCount: 1,
  hasError: true,
  retained: true,
  lastSpanAt: new Date("2026-07-14T10:00:00.042Z"),
};

describe("projectGetTraceForModel", () => {
  it("keeps the summary verbatim and reduces spans to identity + shape only", () => {
    const fullSpan = {
      id: "9007199254740993",
      traceId: "trace-1",
      spanId: "span-a",
      parentSpanId: null,
      name: "GET /pay",
      kind: "server" as const,
      serviceName: "gateway",
      startTs: new Date("2026-07-14T10:00:00.000Z"),
      endTs: new Date("2026-07-14T10:00:00.042Z"),
      durationMs: 42,
      statusCode: "error" as const,
      statusMessage: "boom",
      // Unbounded records that MUST be dropped from the model shape.
      attributes: { "http.method": "GET", big: "x".repeat(5000) },
      events: [{ name: "exception", ts: new Date(), attributes: {} }],
      links: [{ traceId: "t2", spanId: "s2", attributes: {} }],
      resourceAttributes: { "service.name": "gateway", host: "pod-1" },
    };

    const out = projectGetTraceForModel({ summary, spans: [fullSpan] }) as {
      summary: unknown;
      spans: Record<string, unknown>[];
      spanCount: number;
    };

    expect(out.summary).toEqual(summary);
    expect(out.spanCount).toBe(1);
    const span = out.spans[0]!;
    // Kept fields.
    expect(span).toEqual({
      spanId: "span-a",
      parentSpanId: null,
      name: "GET /pay",
      serviceName: "gateway",
      kind: "server",
      durationMs: 42,
      statusCode: "error",
    });
    // Dropped fields.
    for (const dropped of [
      "attributes",
      "events",
      "links",
      "resourceAttributes",
      "startTs",
      "endTs",
      "statusMessage",
      "id",
      "traceId",
    ]) {
      expect(span).not.toHaveProperty(dropped);
    }
  });

  it("returns the output unchanged on a shape mismatch (defensive backstop)", () => {
    const weird = { unexpected: true };
    expect(projectGetTraceForModel(weird)).toBe(weird);
  });
});

describe("projectSearchTracesForModel", () => {
  it("drops retained / lastSpanAt / nextCursor and reports the page size", () => {
    const out = projectSearchTracesForModel({
      traces: [summary],
      nextCursor: { startTs: new Date(), traceId: "trace-1" },
    }) as {
      traces: Record<string, unknown>[];
      returned: number;
    };

    expect(out.returned).toBe(1);
    // The opaque keyset cursor is dropped - the model cannot use it.
    expect(out).not.toHaveProperty("nextCursor");
    const row = out.traces[0]!;
    expect(row).not.toHaveProperty("retained");
    expect(row).not.toHaveProperty("lastSpanAt");
    expect(row.traceId).toBe("trace-1");
    expect(row.startTs).toBe("2026-07-14T10:00:00.000Z");
    expect(row.hasError).toBe(true);
  });

  it("returns the output unchanged on a shape mismatch", () => {
    const weird = { nope: 1 };
    expect(projectSearchTracesForModel(weird)).toBe(weird);
  });
});
