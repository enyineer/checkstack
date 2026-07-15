import { describe, it, expect } from "bun:test";
import { ProtoWriter } from "@checkstack/otlp-wire";
import {
  buildTraceBatchItems,
  createTraceReceiverHandlers,
  estimateTraceItemBytes,
  MAX_SPANS_PER_ITEM,
  TRACESTREAM_TELEMETRY_KIND,
} from "./trace-receiver";
import type { SatelliteTraceBatchItem } from "./trace-wire";
import type { TelemetryEnqueuer } from "./enqueuer";
import type { NormalizedSpan } from "@checkstack/telemetry-common";

const TOKEN = "cktr_s1_secret";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface Captured {
  kind: string;
  items: SatelliteTraceBatchItem[];
}

function capturingEnqueuer(): {
  enqueue: TelemetryEnqueuer;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  return {
    captured,
    enqueue: {
      enqueue: ({ kind, items }) => {
        captured.push({ kind, items: items as SatelliteTraceBatchItem[] });
      },
    },
  };
}

function post(
  url: string,
  body: BodyInit,
  headers: Record<string, string>,
): Request {
  return new Request(`http://localhost${url}`, { method: "POST", body, headers });
}

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Build a minimal `ExportTraceServiceRequest` protobuf with one server span. */
function encodeProtobufRequest(name: string): Uint8Array {
  const w = new ProtoWriter();
  w.message(1, (rs) => {
    rs.message(1, (res) => {
      res.message(1, (kv) => {
        kv.string(1, "service.name");
        kv.message(2, (v) => v.string(1, "checkout"));
      });
    });
    rs.message(2, (ss) => {
      ss.message(2, (sp) => {
        sp.bytes(1, hexToBytes(TRACE_ID));
        sp.bytes(2, hexToBytes(SPAN_ID));
        sp.string(5, name);
        sp.uint(6, 2); // SERVER
        sp.fixed64(7, 1_700_000_000_000_000_000n);
        sp.fixed64(8, 1_700_000_000_840_000_000n);
      });
    });
  });
  return w.finish();
}

const otlpJson = JSON.stringify({
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
              name: "GET /",
              kind: 2,
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000000840000000",
            },
          ],
        },
      ],
    },
  ],
});

const nativeSpan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  name: "native-op",
  kind: "server",
  startTs: "2026-07-13T00:00:00.000Z",
  durationMs: 12,
  ...over,
});

describe("agent trace receiver", () => {
  it("forwards OTLP JSON spans tagged with the presented token", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });

    const res = await otlpTraces(
      post("/v1/traces", otlpJson, {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );

    expect(res.status).toBe(200);
    // Full success => empty OTLP ExportTraceServiceResponse body.
    expect(await res.json()).toEqual({});
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.kind).toBe(TRACESTREAM_TELEMETRY_KIND);
    expect(captured[0]!.items[0]!.streamToken).toBe(TOKEN);
    expect(captured[0]!.items[0]!.spans[0]!.name).toBe("GET /");
    // Wire span carries ISO string timestamps, not Dates.
    expect(typeof captured[0]!.items[0]!.spans[0]!.startTs).toBe("string");
  });

  it("forwards OTLP protobuf spans and answers protobuf", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });
    const bytes = encodeProtobufRequest("proto-op");

    const res = await otlpTraces(
      post("/v1/traces", Buffer.from(bytes), {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/x-protobuf",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-protobuf");
    expect(captured[0]!.items[0]!.spans[0]!.name).toBe("proto-op");
  });

  it("forwards native JSON spans and reports accepted", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { nativeTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });

    const res = await nativeTraces(
      post("/ingest/traces", JSON.stringify({ spans: [nativeSpan(), nativeSpan({ spanId: "051581bf3cb55c14" })] }), {
        "x-checkstack-token": TOKEN,
        "content-type": "application/json",
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2, rejected: 0 });
    expect(captured[0]!.items[0]!.spans.map((s) => s.name)).toEqual([
      "native-op",
      "native-op",
    ]);
  });

  it("reports rejected spans the parser could not decode via partialSuccess", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });
    const mixed = JSON.stringify({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                // Valid span.
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "ok",
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000000840000000",
                },
                // Missing ids -> rejected by the parser.
                { name: "bad" },
              ],
            },
          ],
        },
      ],
    });

    const res = await otlpTraces(
      post("/v1/traces", mixed, {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: "some spans were malformed" },
    });
    // The one valid span is still forwarded.
    expect(captured[0]!.items[0]!.spans).toHaveLength(1);
  });

  it("401s when no cktr_-shaped token is present", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });

    const res = await otlpTraces(
      post("/v1/traces", otlpJson, { "content-type": "application/json" }),
    );
    expect(res.status).toBe(401);

    const wrongShape = await otlpTraces(
      post("/v1/traces", otlpJson, {
        authorization: "Bearer not-a-source-token",
        "content-type": "application/json",
      }),
    );
    expect(wrongShape.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  it("400s a malformed OTLP body", async () => {
    const { enqueue } = capturingEnqueuer();
    const { otlpTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await otlpTraces(
      post("/v1/traces", "{not json", {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a native body with no valid spans", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { nativeTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await nativeTraces(
      post("/ingest/traces", JSON.stringify({ spans: [{ name: "no-ids" }] }), {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  it("405s a non-POST", async () => {
    const { enqueue } = capturingEnqueuer();
    const { nativeTraces } = createTraceReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await nativeTraces(
      new Request("http://localhost/ingest/traces", { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });
});

const span = (): NormalizedSpan => ({
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  name: "x",
  kind: "server",
  startTs: new Date("2026-07-13T00:00:00.000Z"),
  endTs: new Date("2026-07-13T00:00:00.010Z"),
});

describe("buildTraceBatchItems", () => {
  it("splits spans into items of at most MAX_SPANS_PER_ITEM", () => {
    const spans = Array.from({ length: MAX_SPANS_PER_ITEM * 2 + 5 }, () => span());
    const items = buildTraceBatchItems({ streamToken: TOKEN, spans });
    expect(items).toHaveLength(3);
    expect(items[0]!.spans).toHaveLength(MAX_SPANS_PER_ITEM);
    expect(items[2]!.spans).toHaveLength(5);
    expect(items.every((i) => i.streamToken === TOKEN)).toBe(true);
  });

  it("estimateTraceItemBytes grows with payload size", () => {
    const light = buildTraceBatchItems({ streamToken: TOKEN, spans: [span()] })[0]!;
    const heavy = buildTraceBatchItems({
      streamToken: TOKEN,
      spans: [{ ...span(), attributes: { blob: "y".repeat(500) } }],
    })[0]!;
    expect(estimateTraceItemBytes(heavy)).toBeGreaterThan(
      estimateTraceItemBytes(light),
    );
  });
});
