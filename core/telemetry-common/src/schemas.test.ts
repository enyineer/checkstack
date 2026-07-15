import { describe, expect, it } from "bun:test";
import {
  CreateTelemetrySourceSchema,
  SourceBindingsSchema,
  UpdateTelemetrySourceSchema,
} from "./schemas";
import {
  NormalizedLogRecordSchema,
  NormalizedMetricPointSchema,
  NormalizedSpanSchema,
  TELEMETRY_RECORD_SCHEMAS,
} from "./records";
import { TELEMETRY_SIGNALS } from "./signal-model";

describe("SourceBindingsSchema", () => {
  it("accepts one binding per distinct signal", () => {
    const result = SourceBindingsSchema.safeParse([
      { signal: "logs", streamId: "ls-1" },
      { signal: "metrics", streamId: "ms-1" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty binding list", () => {
    expect(SourceBindingsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects two bindings for the same signal", () => {
    const result = SourceBindingsSchema.safeParse([
      { signal: "logs", streamId: "ls-1" },
      { signal: "logs", streamId: "ls-2" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects an empty streamId", () => {
    const result = SourceBindingsSchema.safeParse([
      { signal: "logs", streamId: "" },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("CreateTelemetrySourceSchema", () => {
  it("defaults enabled to true", () => {
    const parsed = CreateTelemetrySourceSchema.parse({
      sourceTypeId: "metricstream.prometheus",
      name: "edge scraper",
      config: { url: "http://example.com/metrics" },
      bindings: [{ signal: "metrics", streamId: "ms-1" }],
    });
    expect(parsed.enabled).toBe(true);
  });
});

describe("UpdateTelemetrySourceSchema", () => {
  it("allows clearing the satellite binding with null", () => {
    const parsed = UpdateTelemetrySourceSchema.parse({ satelliteId: null });
    expect(parsed.satelliteId).toBeNull();
  });

  it("rejects bindings that duplicate a signal", () => {
    const result = UpdateTelemetrySourceSchema.safeParse({
      bindings: [
        { signal: "traces", streamId: "ts-1" },
        { signal: "traces", streamId: "ts-2" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("normalized records", () => {
  it("accepts a minimal log record and preserves correlation ids", () => {
    const parsed = NormalizedLogRecordSchema.parse({
      ts: new Date("2026-07-14T12:00:00Z"),
      body: "connection refused",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    });
    expect(parsed.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("rejects a log record with an out-of-range severity number", () => {
    const result = NormalizedLogRecordSchema.safeParse({
      ts: new Date(),
      body: "x",
      severityNumber: 25,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a counter point with the metricstream-aligned literals", () => {
    const parsed = NormalizedMetricPointSchema.parse({
      name: "http_requests_total",
      type: "counter",
      counterKind: "cumulative",
      labels: { method: "GET" },
      value: 42,
      ts: new Date(),
    });
    expect(parsed.type).toBe("counter");
  });

  it("enforces W3C id lengths on spans", () => {
    const base = {
      name: "GET /charge",
      kind: "server",
      startTs: new Date("2026-07-14T12:00:00.000Z"),
      endTs: new Date("2026-07-14T12:00:00.250Z"),
    };
    expect(
      NormalizedSpanSchema.safeParse({
        ...base,
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
      }).success,
    ).toBe(true);
    expect(
      NormalizedSpanSchema.safeParse({
        ...base,
        traceId: "too-short",
        spanId: "b7ad6b7169203331",
      }).success,
    ).toBe(false);
  });

  it("provides a record schema for every signal", () => {
    for (const signal of TELEMETRY_SIGNALS) {
      expect(TELEMETRY_RECORD_SCHEMAS[signal]).toBeDefined();
    }
  });
});
