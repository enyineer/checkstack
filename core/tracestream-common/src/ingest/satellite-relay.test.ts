import { describe, it, expect } from "bun:test";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import {
  SatelliteSpanSchema,
  SatelliteTraceBatchSchema,
  fromWireSpan,
  toWireSpan,
} from "./satellite-relay";

const fullSpan: NormalizedSpan = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  parentSpanId: "53995c3f42cd8ad8",
  name: "GET /api/users",
  kind: "server",
  startTs: new Date("2026-07-14T10:00:00.123Z"),
  endTs: new Date("2026-07-14T10:00:01.456Z"),
  startUnixNano: 1_784_023_200_123_456_789n,
  endUnixNano: 1_784_023_201_456_789_012n,
  status: { code: "error", message: "boom" },
  attributes: { "http.status_code": 500 },
  events: [
    {
      ts: new Date("2026-07-14T10:00:00.500Z"),
      name: "exception",
      attributes: { "exception.type": "Error" },
    },
  ],
  links: [
    {
      traceId: "af7651916cd43dd8448eb211c80319c0",
      spanId: "b7ad6b7169203331",
      attributes: { kind: "follows-from" },
    },
  ],
  resource: { serviceName: "api", attributes: { "host.name": "node-1" } },
};

const minimalSpan: NormalizedSpan = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  name: "tick",
  kind: "internal",
  startTs: new Date("2026-07-14T10:00:00.000Z"),
  endTs: new Date("2026-07-14T10:00:00.001Z"),
};

describe("satellite trace relay wire helpers", () => {
  it("round-trips a fully-populated span exactly (Dates, bigints, nesting)", () => {
    const wire = toWireSpan(fullSpan);
    // The wire shape must survive JSON transport and its own schema.
    const parsed = SatelliteSpanSchema.parse(JSON.parse(JSON.stringify(wire)));
    expect(fromWireSpan(parsed)).toEqual(fullSpan);
  });

  it("round-trips a minimal span without inventing optional fields", () => {
    const wire = toWireSpan(minimalSpan);
    expect(Object.keys(wire).sort()).toEqual([
      "endTs",
      "kind",
      "name",
      "spanId",
      "startTs",
      "traceId",
    ]);
    expect(fromWireSpan(SatelliteSpanSchema.parse(wire))).toEqual(minimalSpan);
  });

  it("validates a batch and rejects malformed items", () => {
    const batch = [{ streamToken: "cktr_abc", spans: [toWireSpan(fullSpan)] }];
    expect(SatelliteTraceBatchSchema.safeParse(batch).success).toBe(true);
    expect(
      SatelliteTraceBatchSchema.safeParse([
        { streamToken: "cktr_abc", spans: [{ traceId: "too-short" }] },
      ]).success,
    ).toBe(false);
    // Non-ISO timestamps and non-decimal nano strings are rejected.
    expect(
      SatelliteSpanSchema.safeParse({
        ...toWireSpan(minimalSpan),
        startTs: "yesterday",
      }).success,
    ).toBe(false);
    expect(
      SatelliteSpanSchema.safeParse({
        ...toWireSpan(minimalSpan),
        startUnixNano: "0x123",
      }).success,
    ).toBe(false);
  });

  it("enforces canonical lowercase-hex ids (parity with the direct-ingest parsers)", () => {
    expect(
      SatelliteSpanSchema.safeParse({
        ...toWireSpan(minimalSpan),
        traceId: "4BF92F3577B34DA6A3CE929D0E0E4736",
      }).success,
    ).toBe(false);
    expect(
      SatelliteSpanSchema.safeParse({
        ...toWireSpan(minimalSpan),
        spanId: "zzf067aa0ba902b7",
      }).success,
    ).toBe(false);
  });

  it("enforces the per-span structural caps (attributes/events/links)", () => {
    const base = toWireSpan(minimalSpan);
    const overAttributes = Object.fromEntries(
      Array.from({ length: 257 }, (_, i) => [`k${i}`, i]),
    );
    expect(
      SatelliteSpanSchema.safeParse({ ...base, attributes: overAttributes })
        .success,
    ).toBe(false);
    const event = { ts: base.startTs, name: "e" };
    expect(
      SatelliteSpanSchema.safeParse({
        ...base,
        events: Array.from({ length: 129 }, () => event),
      }).success,
    ).toBe(false);
    const link = {
      traceId: "af7651916cd43dd8448eb211c80319c0",
      spanId: "b7ad6b7169203331",
    };
    expect(
      SatelliteSpanSchema.safeParse({
        ...base,
        links: Array.from({ length: 129 }, () => link),
      }).success,
    ).toBe(false);
    // At-cap payloads still pass.
    expect(
      SatelliteSpanSchema.safeParse({
        ...base,
        events: Array.from({ length: 128 }, () => event),
      }).success,
    ).toBe(true);
  });
});
