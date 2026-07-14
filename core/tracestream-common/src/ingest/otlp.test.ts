import { describe, it, expect } from "bun:test";
import { ProtoWriter } from "@checkstack/otlp-wire";
import {
  decodeExportTraceServiceRequest,
  parseOtlpTracesJson,
  exportTraceServiceResponseJson,
} from "./otlp";

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";
const PARENT_ID = "eee19b7ec3c1b174";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

interface SpanSpec {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startNano: bigint;
  endNano: bigint;
  status?: { code: number; message?: string };
}

/** Build a minimal `ExportTraceServiceRequest` protobuf with a `service.name`. */
function encodeRequest(spans: SpanSpec[], serviceName = "checkout"): Uint8Array {
  const w = new ProtoWriter();
  w.message(1, (rs) => {
    rs.message(1, (res) => {
      // resource.attributes[0] = { key: "service.name", value: { stringValue } }
      res.message(1, (kv) => {
        kv.string(1, "service.name");
        kv.message(2, (v) => v.string(1, serviceName));
      });
    });
    rs.message(2, (ss) => {
      for (const s of spans) {
        ss.message(2, (sp) => {
          sp.bytes(1, hexToBytes(s.traceId));
          sp.bytes(2, hexToBytes(s.spanId));
          if (s.parentSpanId) sp.bytes(4, hexToBytes(s.parentSpanId));
          sp.string(5, s.name);
          sp.uint(6, s.kind);
          sp.fixed64(7, s.startNano);
          sp.fixed64(8, s.endNano);
          if (s.status) {
            sp.message(15, (st) => {
              if (s.status!.message) st.string(2, s.status!.message);
              st.uint(3, s.status!.code);
            });
          }
        });
      }
    });
  });
  return w.finish();
}

describe("decodeExportTraceServiceRequest (protobuf)", () => {
  it("decodes a span with ids, kind, times, status and resource service", () => {
    const buf = encodeRequest([
      {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        parentSpanId: PARENT_ID,
        name: "POST /checkout",
        kind: 2, // SERVER
        startNano: 1_700_000_000_000_000_000n,
        endNano: 1_700_000_000_840_000_000n,
        status: { code: 2, message: "boom" }, // ERROR
      },
    ]);
    const { spans, rejected } = decodeExportTraceServiceRequest(buf);
    expect(rejected).toBe(0);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.traceId).toBe(TRACE_ID);
    expect(span.spanId).toBe(SPAN_ID);
    expect(span.parentSpanId).toBe(PARENT_ID);
    expect(span.name).toBe("POST /checkout");
    expect(span.kind).toBe("server");
    expect(span.status).toEqual({ code: "error", message: "boom" });
    expect(span.resource?.serviceName).toBe("checkout");
    expect(span.startTs.getTime()).toBe(1_700_000_000_000);
    expect(span.endTs.getTime()).toBe(1_700_000_000_840);
    expect(Number(span.startUnixNano)).toBe(1_700_000_000_000_000_000);
  });

  it("maps every span kind and treats unspecified as internal", () => {
    const kinds = [0, 1, 2, 3, 4, 5];
    const buf = encodeRequest(
      kinds.map((k, i) => ({
        traceId: TRACE_ID,
        spanId: SPAN_ID.slice(0, 15) + String(i),
        name: "op",
        kind: k,
        startNano: 1_700_000_000_000_000_000n,
        endNano: 1_700_000_000_000_000_000n,
      })),
    );
    const { spans } = decodeExportTraceServiceRequest(buf);
    expect(spans.map((s) => s.kind)).toEqual([
      "internal",
      "internal",
      "server",
      "client",
      "producer",
      "consumer",
    ]);
  });

  it("rejects a span with the wrong trace-id length (counted, not thrown)", () => {
    const buf = encodeRequest([
      {
        traceId: "abcd", // too short
        spanId: SPAN_ID,
        name: "op",
        kind: 1,
        startNano: 1n,
        endNano: 2n,
      },
    ]);
    const { spans, rejected } = decodeExportTraceServiceRequest(buf);
    expect(spans).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it("skips unknown top-level fields (forward-compatible)", () => {
    const w = new ProtoWriter();
    w.string(9, "some future field"); // unknown field number
    const withUnknown = new Uint8Array([
      ...w.finish(),
      ...encodeRequest([
        {
          traceId: TRACE_ID,
          spanId: SPAN_ID,
          name: "op",
          kind: 1,
          startNano: 1n,
          endNano: 2n,
        },
      ]),
    ]);
    const { spans } = decodeExportTraceServiceRequest(withUnknown);
    expect(spans).toHaveLength(1);
  });

  it("surfaces malformed protobuf as a throw the endpoint maps to 400", () => {
    // Wire type 7 is invalid; the shared reader rejects it. The OTLP handler
    // wraps decode in try/catch and answers 400 - see the endpoint tests.
    expect(() =>
      decodeExportTraceServiceRequest(new Uint8Array([0xff, 0x01, 0x02, 0x03])),
    ).toThrow();
  });
});

describe("parseOtlpTracesJson", () => {
  const base = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout" } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                parentSpanId: PARENT_ID,
                name: "GET /cart",
                kind: "SPAN_KIND_CLIENT",
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000000500000000",
                status: { code: "STATUS_CODE_OK" },
                attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
              },
            ],
          },
        ],
      },
    ],
  };

  it("parses camelCase JSON with enum-name kind/status and hex ids", () => {
    const { spans, rejected } = parseOtlpTracesJson(base);
    expect(rejected).toBe(0);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.kind).toBe("client");
    expect(span.status?.code).toBe("ok");
    expect(span.resource?.serviceName).toBe("checkout");
    expect(span.attributes).toEqual({ "http.method": "GET" });
    expect(span.startTs.getTime()).toBe(1_700_000_000_000);
    expect(span.endTs.getTime()).toBe(1_700_000_000_500);
  });

  it("keeps a large proto3-JSON int64 attribute exact as a string", () => {
    // OTLP JSON encodes int64 as a STRING. Coercing via Number() would round a
    // value above 2^53 (Finding 5); we keep the original string for those and
    // only parse safe integers to numbers.
    const { spans } = parseOtlpTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "op",
                  kind: 1,
                  attributes: [
                    { key: "big", value: { intValue: "9223372036854775807" } },
                    { key: "small", value: { intValue: "123" } },
                    { key: "num", value: { intValue: 42 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const attrs = spans[0]!.attributes ?? {};
    // Above 2^53: preserved exactly as the original string, no precision loss.
    expect(attrs.big).toBe("9223372036854775807");
    // Safe integers become numbers (string or numeric input alike).
    expect(attrs.small).toBe(123);
    expect(attrs.num).toBe(42);
  });

  it("accepts snake_case keys and numeric kind", () => {
    const { spans } = parseOtlpTracesJson({
      resource_spans: [
        {
          scope_spans: [
            {
              spans: [
                {
                  trace_id: TRACE_ID,
                  span_id: SPAN_ID,
                  name: "op",
                  kind: 3,
                  start_time_unix_nano: 1_700_000_000_000_000_000,
                  end_time_unix_nano: 1_700_000_000_000_000_000,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(spans[0]!.kind).toBe("client");
  });

  it("decodes base64 ids to hex", () => {
    // 16-byte trace id / 8-byte span id, base64-encoded.
    const traceB64 = Buffer.from(hexToBytes(TRACE_ID)).toString("base64");
    const spanB64 = Buffer.from(hexToBytes(SPAN_ID)).toString("base64");
    const { spans, rejected } = parseOtlpTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ traceId: traceB64, spanId: spanB64, name: "op", kind: 1 }] },
          ],
        },
      ],
    });
    expect(rejected).toBe(0);
    expect(spans[0]!.traceId).toBe(TRACE_ID);
    expect(spans[0]!.spanId).toBe(SPAN_ID);
  });

  it("rejects a malformed id and returns [] for a non-object", () => {
    const { spans, rejected } = parseOtlpTracesJson({
      resourceSpans: [
        { scopeSpans: [{ spans: [{ traceId: "zz", spanId: SPAN_ID, name: "op" }] }] },
      ],
    });
    expect(spans).toHaveLength(0);
    expect(rejected).toBe(1);
    expect(parseOtlpTracesJson(null).spans).toHaveLength(0);
    expect(parseOtlpTracesJson("nope").spans).toHaveLength(0);
  });

  it("caps a hostile attribute explosion", () => {
    const attributes = Array.from({ length: 5_000 }, (_, i) => ({
      key: `k${i}`,
      value: { intValue: i },
    }));
    const { spans } = parseOtlpTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ traceId: TRACE_ID, spanId: SPAN_ID, name: "op", kind: 1, attributes }] },
          ],
        },
      ],
    });
    expect(Object.keys(spans[0]!.attributes ?? {}).length).toBeLessThanOrEqual(256);
  });
});

describe("exportTraceServiceResponseJson", () => {
  it("is empty on full success and carries partialSuccess otherwise", () => {
    expect(exportTraceServiceResponseJson()).toEqual({});
    expect(exportTraceServiceResponseJson({ rejectedSpans: 0, errorMessage: "x" })).toEqual({});
    expect(
      exportTraceServiceResponseJson({ rejectedSpans: 3, errorMessage: "dropped" }),
    ).toEqual({ partialSuccess: { rejectedSpans: 3, errorMessage: "dropped" } });
  });
});
