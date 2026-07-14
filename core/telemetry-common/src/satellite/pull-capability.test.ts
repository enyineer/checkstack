import { describe, expect, it } from "bun:test";
import {
  TelemetryPullBatchSchema,
  TelemetryPullConfigSchema,
  WireSpanSchema,
  countWireRecords,
  filterWireRecordsToSignals,
  normalizedLogRecordToWire,
  normalizedMetricPointToWire,
  normalizedSpanToWire,
  wireLogRecordToNormalized,
  wireMetricPointToNormalized,
  wirePullRecordsToNormalized,
  wireSpanToNormalized,
} from "./pull-capability";
import type { NormalizedSpan } from "../records";

const span: NormalizedSpan = {
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  name: "GET /charge",
  kind: "server",
  startTs: new Date("2026-07-14T12:00:00.000Z"),
  endTs: new Date("2026-07-14T12:00:00.250Z"),
  startUnixNano: 1_784_030_400_000_000_000n,
  endUnixNano: 1_784_030_400_250_000_000n,
  status: { code: "error", message: "boom" },
  events: [{ ts: new Date("2026-07-14T12:00:00.100Z"), name: "exception" }],
};

describe("wire record round-trips", () => {
  it("round-trips a log record through the wire shape", () => {
    const normalized = {
      ts: new Date("2026-07-14T11:59:00.000Z"),
      body: "connection refused",
      severityNumber: 17,
      traceId: "0af7651916cd43dd8448eb211c80319c",
    };
    const wire = normalizedLogRecordToWire(normalized);
    expect(wire.ts).toBe("2026-07-14T11:59:00.000Z");
    expect(wireLogRecordToNormalized(wire)).toEqual(normalized);
  });

  it("round-trips a metric point through the wire shape", () => {
    const normalized = {
      name: "http_requests_total",
      type: "counter" as const,
      counterKind: "cumulative" as const,
      labels: { method: "GET" },
      value: 42,
      ts: new Date("2026-07-14T11:59:00.000Z"),
    };
    const wire = normalizedMetricPointToWire(normalized);
    expect(wireMetricPointToNormalized(wire)).toEqual(normalized);
  });

  it("round-trips a span, including bigint nanos and event timestamps", () => {
    const wire = normalizedSpanToWire(span);
    expect(wire.startUnixNano).toBe("1784030400000000000");
    expect(WireSpanSchema.safeParse(wire).success).toBe(true);
    expect(wireSpanToNormalized(wire)).toEqual(span);
  });

  it("converts a full wire records bundle per signal", () => {
    const bundle = wirePullRecordsToNormalized({
      logs: [normalizedLogRecordToWire({ ts: span.startTs, body: "x" })],
      traces: [normalizedSpanToWire(span)],
    });
    expect(bundle.logs?.[0]?.ts).toEqual(span.startTs);
    expect(bundle.traces?.[0]?.startUnixNano).toBe(span.startUnixNano);
    expect(bundle.metrics).toBeUndefined();
  });
});

describe("wire bundle helpers", () => {
  const bundle = {
    logs: [normalizedLogRecordToWire({ ts: span.startTs, body: "x" })],
    traces: [normalizedSpanToWire(span)],
  };

  it("counts records across every signal", () => {
    expect(countWireRecords(bundle)).toBe(2);
    expect(countWireRecords({})).toBe(0);
  });

  it("filters to bound signals and drops empty arrays", () => {
    const filtered = filterWireRecordsToSignals({
      records: { ...bundle, metrics: [] },
      signals: ["logs", "metrics"],
    });
    expect(filtered.logs).toHaveLength(1);
    expect(filtered.traces).toBeUndefined();
    expect(filtered.metrics).toBeUndefined();
  });
});

describe("capability payload schemas", () => {
  it("accepts a config payload with secret advisories", () => {
    const result = TelemetryPullConfigSchema.safeParse({
      instances: [
        {
          id: "src-1",
          sourceTypeId: "someplugin.cloudwatch",
          name: "prod account",
          intervalSeconds: 60,
          timeoutMs: 30_000,
          config: { region: "eu-central-1" },
          secretFields: ["secretAccessKey"],
          boundSignals: ["logs", "metrics"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a batch entry whose records fail the wire schema", () => {
    const result = TelemetryPullBatchSchema.safeParse([
      {
        instanceId: "src-1",
        records: { metrics: [{ name: "x", type: "counter", value: 1 }] },
      },
    ]);
    expect(result.success).toBe(false);
  });
});
