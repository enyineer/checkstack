import { describe, it, expect } from "bun:test";
import {
  evaluateAssertion,
  toJsonSchema,
  type CollectorRunContext,
} from "@checkstack/backend-api";
import type { TraceWindowLatency } from "../storage";
import type { TraceStreamHealthClient } from "./strategy";
import type {
  TraceStreamHealthReader,
  WindowSpanTotals,
  WindowTraceTotals,
} from "./reader";
import { TraceWindowCollector } from "./window-collector";
import { OperationLatencyCollector } from "./operation-latency-collector";

const STREAM_CREATED = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-01-01T12:03:00.000Z");

const zeroLatency: TraceWindowLatency = {
  spanCount: 0,
  errorCount: 0,
  durSumMs: 0,
  durMinMs: null,
  durMaxMs: null,
  p95Ms: null,
};

interface FakeReads {
  spanTotals?: Partial<WindowSpanTotals>;
  traceTotals?: Partial<WindowTraceTotals>;
  lastReceivedAt?: Date | null;
  latency?: Partial<TraceWindowLatency>;
  /** When set, the named read rejects (simulating a storage/transport failure). */
  failOn?: keyof TraceStreamHealthReader;
}

function fakeReader(reads: FakeReads): TraceStreamHealthReader {
  const fail = (name: keyof TraceStreamHealthReader) => {
    if (reads.failOn === name) {
      return Promise.reject(new Error(`read ${String(name)} failed`));
    }
    return undefined;
  };
  return {
    streamId: "stream-1",
    streamCreatedAt: STREAM_CREATED,
    readWindowSpanTotals: () =>
      fail("readWindowSpanTotals") ??
      Promise.resolve({ spanCount: 0, errorSpanCount: 0, ...reads.spanTotals }),
    readWindowTraceTotals: () =>
      fail("readWindowTraceTotals") ??
      Promise.resolve({ traceCount: 0, errorTraceCount: 0, ...reads.traceTotals }),
    readLastReceivedAt: () =>
      fail("readLastReceivedAt") ??
      Promise.resolve(reads.lastReceivedAt ?? null),
    readOperationLatency: () =>
      fail("readOperationLatency") ??
      Promise.resolve({ ...zeroLatency, ...reads.latency }),
  };
}

function fakeClient(reads: FakeReads): TraceStreamHealthClient {
  return {
    streamId: "stream-1",
    reader: fakeReader(reads),
    exec: () => Promise.reject(new Error("unused")),
  };
}

const runContext = (intervalSeconds: number): CollectorRunContext => ({
  check: { id: "c1", name: "traces", intervalSeconds },
  system: { id: "sys1", name: "System" },
});

describe("TraceWindowCollector", () => {
  it("computes window metrics from seeded aggregates", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    const { result } = await collector.execute({
      config: { windowSeconds: 300 },
      client: fakeClient({
        spanTotals: { spanCount: 120, errorSpanCount: 8 },
        traceTotals: { traceCount: 30, errorTraceCount: 5 },
        lastReceivedAt: new Date("2026-01-01T12:02:30.000Z"),
      }),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });

    expect(result.spanCount).toBe(120);
    expect(result.traceCount).toBe(30);
    expect(result.errorSpanCount).toBe(8);
    expect(result.errorTraceCount).toBe(5);
    // 8 error spans / 5 minutes = 1.6
    expect(result.errorRatePerMinute).toBe(1.6);
    expect(result.secondsSinceLastSpan).toBe(30);
  });

  it("returns secondsSinceLastSpan since creation when never received", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    const { result } = await collector.execute({
      config: {},
      client: fakeClient({ lastReceivedAt: null }),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    expect(result.spanCount).toBe(0);
    // 12:03:00 - 00:00:00 = 43380s.
    expect(result.secondsSinceLastSpan).toBe(43380);
  });

  it("propagates a read failure as a thrown transport error (never an error field)", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    await expect(
      collector.execute({
        config: {},
        client: fakeClient({ failOn: "readWindowSpanTotals" }),
        pluginId: "tracestream.tracestream",
        runContext: runContext(60),
      }),
    ).rejects.toThrow("read readWindowSpanTotals failed");
  });

  it("does NOT set an error field for a silent (zero) window", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    const outcome = await collector.execute({
      config: {},
      client: fakeClient({}),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result.errorSpanCount).toBe(0);
  });

  it("supports error assertions via errorSpanCount", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    const { result } = await collector.execute({
      config: { windowSeconds: 300 },
      client: fakeClient({ spanTotals: { spanCount: 50, errorSpanCount: 7 } }),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    const evaluated = evaluateAssertion(
      { field: "errorSpanCount", operator: "greaterThanOrEqual", value: 5 },
      result as unknown as Record<string, unknown>,
    );
    expect(evaluated.passed).toBe(true);
    expect(evaluated.actual).toBe(7);
  });

  it("supports absence assertions via secondsSinceLastSpan", async () => {
    const collector = new TraceWindowCollector(() => NOW);
    const { result } = await collector.execute({
      config: {},
      client: fakeClient({
        lastReceivedAt: new Date("2026-01-01T11:50:00.000Z"),
      }),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    // 13 minutes of silence = 780s; assert "no spans for 10 min" => fails.
    expect(result.secondsSinceLastSpan).toBe(780);
    const evaluated = evaluateAssertion(
      { field: "secondsSinceLastSpan", operator: "lessThan", value: 600 },
      result as unknown as Record<string, unknown>,
    );
    expect(evaluated.passed).toBe(false);
  });
});

describe("OperationLatencyCollector", () => {
  it("declares the operation picker's dependency on serviceName in the config schema", () => {
    // The spanName resolver reads `serviceName` from the SAME form, and the
    // editor only re-fetches a picker's options when a field listed in
    // `x-depends-on` changes. Without this annotation the options fetch runs
    // once at mount (serviceName still empty) and the picker stays permanently
    // at "No options available".
    const collector = new OperationLatencyCollector(() => NOW);
    const jsonSchema = toJsonSchema(collector.config.schema);
    expect(jsonSchema).toMatchObject({
      properties: {
        serviceName: { "x-options-resolver": "tracestreamServiceName" },
        spanName: {
          "x-options-resolver": "tracestreamSpanName",
          "x-depends-on": ["serviceName"],
        },
      },
    });
  });

  it("allows multiple instances (one per watched operation)", () => {
    const collector = new OperationLatencyCollector(() => NOW);
    expect(collector.allowMultiple).toBe(true);
  });

  it("derives p95/avg/max/errorRate from a merged window aggregate", async () => {
    const collector = new OperationLatencyCollector(() => NOW);
    const { result } = await collector.execute({
      config: { serviceName: "checkout", spanName: "POST /pay", windowSeconds: 300 },
      client: fakeClient({
        latency: {
          spanCount: 40,
          errorCount: 2,
          durSumMs: 4000,
          durMaxMs: 900,
          p95Ms: 512,
        },
      }),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    expect(result.p95Ms).toBe(512);
    expect(result.avgMs).toBe(100);
    expect(result.maxMs).toBe(900);
    expect(result.spanCount).toBe(40);
    expect(result.errorCount).toBe(2);
    expect(result.errorRate).toBe(0.05);
  });

  it("reports zeroed values (never null) for a no-span window", async () => {
    const collector = new OperationLatencyCollector(() => NOW);
    const outcome = await collector.execute({
      config: { serviceName: "checkout" },
      client: fakeClient({}),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result.spanCount).toBe(0);
    expect(outcome.result.p95Ms).toBe(0);
    expect(outcome.result.avgMs).toBe(0);
    expect(outcome.result.maxMs).toBe(0);
    expect(outcome.result.errorRate).toBe(0);
  });

  it("guards a latency assertion with spanCount (no-data window does not trip p95Ms < 100)", async () => {
    const collector = new OperationLatencyCollector(() => NOW);
    const { result } = await collector.execute({
      config: { serviceName: "checkout" },
      client: fakeClient({}),
      pluginId: "tracestream.tracestream",
      runContext: runContext(60),
    });
    // p95Ms is 0 on an empty window, so `p95Ms < 100` would falsely pass;
    // pairing it with `spanCount > 0` distinguishes "no data" from a real low.
    const hasSpans = evaluateAssertion(
      { field: "spanCount", operator: "greaterThan", value: 0 },
      result as unknown as Record<string, unknown>,
    );
    expect(hasSpans.passed).toBe(false);
  });

  it("propagates a read failure as a thrown transport error (never an error field)", async () => {
    const collector = new OperationLatencyCollector(() => NOW);
    await expect(
      collector.execute({
        config: { serviceName: "checkout" },
        client: fakeClient({ failOn: "readOperationLatency" }),
        pluginId: "tracestream.tracestream",
        runContext: runContext(60),
      }),
    ).rejects.toThrow("read readOperationLatency failed");
  });
});
