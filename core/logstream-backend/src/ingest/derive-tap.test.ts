import { describe, it, expect } from "bun:test";
import type { IngestedLine } from "@checkstack/logstream-common";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import { createLogDeriveTap, toNormalizedLogRecord } from "./derive-tap";

function line(overrides: Partial<IngestedLine> = {}): IngestedLine {
  return {
    ts: new Date("2026-01-01T00:00:00.000Z"),
    observedAt: new Date("2026-01-01T00:00:01.000Z"),
    severityNumber: 9,
    band: "info",
    body: "hello",
    ...overrides,
  };
}

/**
 * A line whose `ts` read is counted. `toNormalizedLogRecord` reads `ts` first
 * for every record, so `conversions()` is exactly how many records were mapped -
 * letting a test prove the lazy thunk did NO conversion work until (and unless)
 * the dispatcher materialized it.
 */
function countingLine(): { line: IngestedLine; conversions: () => number } {
  let n = 0;
  const base = line();
  const observed: IngestedLine = { ...base };
  // Redefine `ts` as a counting accessor at runtime (TS still sees a plain line).
  Object.defineProperty(observed, "ts", {
    get() {
      n += 1;
      return base.ts;
    },
    enumerable: true,
    configurable: true,
  });
  return { line: observed, conversions: () => n };
}

describe("toNormalizedLogRecord", () => {
  it("maps core fields and drops sink-derived fields (observedAt, band)", () => {
    const record = toNormalizedLogRecord(
      line({ severityText: "INFO", attributes: { k: "v" }, traceId: "abc", spanId: "def" }),
    );
    expect(record).toEqual({
      ts: new Date("2026-01-01T00:00:00.000Z"),
      severityNumber: 9,
      severityText: "INFO",
      body: "hello",
      attributes: { k: "v" },
      traceId: "abc",
      spanId: "def",
    });
  });

  it("unfolds the flat resource back into serviceName + attributes (inverse of foldResource)", () => {
    const record = toNormalizedLogRecord(
      line({ resource: { "service.name": "api", region: "us-east" } }),
    );
    expect(record.resource).toEqual({
      serviceName: "api",
      attributes: { region: "us-east" },
    });
  });

  it("omits resource entirely when the flat map is empty or absent", () => {
    expect(toNormalizedLogRecord(line()).resource).toBeUndefined();
    expect(toNormalizedLogRecord(line({ resource: {} })).resource).toBeUndefined();
  });

  it("keeps a resource with only attributes (no serviceName)", () => {
    const record = toNormalizedLogRecord(line({ resource: { region: "eu" } }));
    expect(record.resource).toEqual({ attributes: { region: "eu" } });
  });

  it("parity: a NormalizedLogRecord folded like the sink round-trips back", () => {
    // Mirrors telemetry-sink's toIngestedLine output for an already-normalized
    // record: serviceName folded under `service.name`, band/observedAt derived.
    const original: NormalizedLogRecord = {
      ts: new Date("2026-01-01T00:00:00.000Z"),
      severityNumber: 17,
      severityText: "ERROR",
      body: "boom",
      attributes: { a: 1 },
      resource: { serviceName: "api", attributes: { region: "us" } },
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
    };
    const asLine: IngestedLine = {
      ts: original.ts,
      observedAt: new Date("2026-01-01T00:00:02.000Z"),
      severityNumber: original.severityNumber!,
      severityText: original.severityText,
      band: "error",
      body: original.body,
      attributes: original.attributes,
      resource: { "service.name": "api", region: "us" },
      traceId: original.traceId,
      spanId: original.spanId,
    };
    expect(toNormalizedLogRecord(asLine)).toEqual(original);
  });
});

describe("createLogDeriveTap", () => {
  it("is a no-op until a dispatch is connected", async () => {
    const tap = createLogDeriveTap();
    // Must not throw with no dispatch connected.
    await tap.onDeriveFlush({ streamId: "s1", lines: [line()] });
  });

  it("dispatches records via a thunk the dispatcher materializes once connected", async () => {
    const tap = createLogDeriveTap();
    const calls: { streamId: string; count: number }[] = [];
    tap.connect(async ({ streamId, records }) => {
      // The dispatcher materializes the batch only when a derive instance
      // matches; simulate a match by invoking the thunk.
      const materialized = typeof records === "function" ? records() : records;
      calls.push({ streamId, count: materialized.length });
    });
    await tap.onDeriveFlush({ streamId: "s1", lines: [line(), line()] });
    expect(calls).toEqual([{ streamId: "s1", count: 2 }]);
  });

  it("passes records as a LAZY thunk, not a pre-built array", async () => {
    const tap = createLogDeriveTap();
    let received: unknown;
    tap.connect(async ({ records }) => void (received = records));
    await tap.onDeriveFlush({ streamId: "s1", lines: [line()] });
    expect(typeof received).toBe("function");
  });

  it("does no conversion work when no dispatch is connected", async () => {
    const tap = createLogDeriveTap();
    const { line: observed, conversions } = countingLine();
    await tap.onDeriveFlush({ streamId: "s1", lines: [observed] });
    expect(conversions()).toBe(0);
  });

  it("does no conversion work until the dispatcher invokes the thunk", async () => {
    const tap = createLogDeriveTap();
    const { line: observed, conversions } = countingLine();
    let thunk: (() => readonly unknown[]) | null = null;
    // A dispatcher that matches no derive instance never calls records().
    tap.connect(async ({ records }) => {
      thunk = typeof records === "function" ? records : null;
    });
    await tap.onDeriveFlush({ streamId: "s1", lines: [observed] });
    expect(conversions()).toBe(0); // not materialized while unmatched
    thunk!(); // a matching instance now asks for the batch
    expect(conversions()).toBe(1);
  });

  it("skips dispatch for an empty batch", async () => {
    const tap = createLogDeriveTap();
    let called = false;
    tap.connect(async () => void (called = true));
    await tap.onDeriveFlush({ streamId: "s1", lines: [] });
    expect(called).toBe(false);
  });
});
