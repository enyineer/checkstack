import { describe, it, expect } from "bun:test";
import type { NormalizedDatapoint } from "../schemas";
import {
  MetricstreamForwardBatchSchema,
  WireDatapointSchema,
  normalizedDatapointToWire,
  wireDatapointToNormalized,
} from "./forward-capability";

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

describe("WireDatapointSchema + wireDatapointToNormalized", () => {
  it("round-trips a datapoint's ts AND each exemplar's ts through ISO strings", () => {
    // What the agent puts on the wire: Dates serialized to ISO strings, both on
    // the point and inside each exemplar (JSON has no Date type).
    const onWire = JSON.parse(
      JSON.stringify({
        name: "reqs",
        type: "counter",
        counterKind: "cumulative",
        labels: { code: "200" },
        value: 5,
        ts: new Date("2026-07-12T12:00:00.000Z"),
        exemplars: [
          {
            traceId: TRACE,
            spanId: SPAN,
            value: 5,
            ts: new Date("2026-07-12T12:00:01.000Z"),
          },
        ],
      }),
    );

    const wire = WireDatapointSchema.parse(onWire);
    expect(typeof wire.ts).toBe("string");
    expect(typeof wire.exemplars?.[0].ts).toBe("string");

    const normalized = wireDatapointToNormalized(wire);
    expect(normalized.ts).toEqual(new Date("2026-07-12T12:00:00.000Z"));
    expect(normalized.exemplars).toEqual([
      {
        traceId: TRACE,
        spanId: SPAN,
        value: 5,
        ts: new Date("2026-07-12T12:00:01.000Z"),
      },
    ]);
  });

  it("handles a datapoint with no exemplars (field stays absent)", () => {
    const wire = WireDatapointSchema.parse({
      name: "g",
      type: "gauge",
      labels: {},
      value: 1,
      ts: "2026-07-12T12:00:00.000Z",
    });
    const normalized = wireDatapointToNormalized(wire);
    expect(normalized.exemplars).toBeUndefined();
    expect(normalized.ts).toEqual(new Date("2026-07-12T12:00:00.000Z"));
  });

  it("normalizedDatapointToWire is the exact inverse (exemplar ts round-trips)", () => {
    const original: NormalizedDatapoint = {
      name: "reqs",
      type: "counter",
      counterKind: "cumulative",
      labels: { code: "200" },
      value: 5,
      ts: new Date("2026-07-12T12:00:00.000Z"),
      exemplars: [
        { traceId: TRACE, spanId: SPAN, value: 5, ts: new Date("2026-07-12T12:00:01.000Z") },
      ],
    };
    const wire = normalizedDatapointToWire(original);
    expect(typeof wire.ts).toBe("string");
    expect(typeof wire.exemplars?.[0].ts).toBe("string");
    // Parse through the schema (as the core end does) then convert back.
    const roundTripped = wireDatapointToNormalized(WireDatapointSchema.parse(wire));
    expect(roundTripped).toEqual(original);
  });

  it("validates a full forward batch (per-token groups) with exemplars", () => {
    const batch = MetricstreamForwardBatchSchema.parse([
      {
        streamToken: "ckms_abc",
        datapoints: [
          {
            name: "reqs",
            type: "counter",
            counterKind: "cumulative",
            labels: {},
            value: 1,
            ts: "2026-07-12T12:00:00.000Z",
            exemplars: [{ traceId: TRACE, value: 1, ts: "2026-07-12T12:00:00.000Z" }],
          },
        ],
      },
    ]);
    expect(batch[0].datapoints[0].exemplars).toHaveLength(1);
  });
});
