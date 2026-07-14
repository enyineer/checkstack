import { describe, it, expect } from "bun:test";
import { parseNativeTraces } from "./native";

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";
const PARENT_ID = "eee19b7ec3c1b174";

describe("parseNativeTraces", () => {
  it("parses a bare array of spans with ISO times and serviceName", () => {
    const { spans, rejected } = parseNativeTraces([
      {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        parentSpanId: PARENT_ID,
        name: "handle",
        kind: "server",
        serviceName: "api",
        startTs: "2026-07-14T12:00:00.000Z",
        endTs: "2026-07-14T12:00:00.250Z",
        statusCode: "error",
        statusMessage: "nope",
        attributes: { "http.route": "/x" },
        resourceAttributes: { "host.name": "pod-1" },
      },
    ]);
    expect(rejected).toBe(0);
    const span = spans[0]!;
    expect(span.kind).toBe("server");
    expect(span.resource?.serviceName).toBe("api");
    expect(span.resource?.attributes).toEqual({ "host.name": "pod-1" });
    expect(span.status).toEqual({ code: "error", message: "nope" });
    expect(span.startTs.toISOString()).toBe("2026-07-14T12:00:00.000Z");
    expect(span.endTs.toISOString()).toBe("2026-07-14T12:00:00.250Z");
  });

  it("accepts a { spans: [] } envelope and epoch-ms times", () => {
    const { spans } = parseNativeTraces({
      spans: [
        {
          traceId: TRACE_ID,
          spanId: SPAN_ID,
          name: "op",
          startTs: 1_760_000_000_000,
          durationMs: 40,
        },
      ],
    });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.startTs.getTime()).toBe(1_760_000_000_000);
    // endTs derived from durationMs when absent.
    expect(spans[0]!.endTs.getTime()).toBe(1_760_000_000_040);
  });

  it("defaults an unknown kind/status and a root span has no parent", () => {
    const { spans } = parseNativeTraces([
      { traceId: TRACE_ID, spanId: SPAN_ID, name: "op", startTs: 1, kind: "bogus", statusCode: "weird" },
    ]);
    expect(spans[0]!.kind).toBe("internal");
    expect(spans[0]!.status).toBeUndefined();
    expect(spans[0]!.parentSpanId).toBeUndefined();
  });

  it("rejects spans with malformed ids or missing start, counting them", () => {
    const { spans, rejected } = parseNativeTraces([
      { traceId: "short", spanId: SPAN_ID, name: "op", startTs: 1 },
      { traceId: TRACE_ID, spanId: "short", name: "op", startTs: 1 },
      { traceId: TRACE_ID, spanId: SPAN_ID, name: "op" }, // no start
      { traceId: TRACE_ID, spanId: SPAN_ID, name: "ok", startTs: 5 },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("ok");
    expect(rejected).toBe(3);
  });

  it("does not throw on non-object input", () => {
    expect(parseNativeTraces(null).spans).toHaveLength(0);
    expect(parseNativeTraces(42).spans).toHaveLength(0);
    expect(parseNativeTraces("x").rejected).toBe(0);
  });
});
