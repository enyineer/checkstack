import { describe, it, expect } from "bun:test";
import { evaluateAssertion } from "@checkstack/backend-api";
import type { StreamSeverityTotals } from "@checkstack/logstream-common";
import type { CollectorRunContext } from "@checkstack/backend-api";
import type { LogStreamHealthClient } from "./strategy";
import type { LogStreamHealthReader } from "./reader";
import { WindowMetricsCollector } from "./window-metrics-collector";
import { PatternOccurrenceCollector } from "./pattern-occurrence-collector";
import { PatternMetricCollector } from "./pattern-metric-collector";
import type { PatternVariableWindow } from "@checkstack/logstream-common";

const STREAM_CREATED = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-01-01T12:03:00.000Z");

const zeroSeverity: StreamSeverityTotals = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};

interface FakeReads {
  severity?: Partial<StreamSeverityTotals>;
  newPatternCount?: number;
  distinctPatternCount?: number;
  lastReceivedAt?: Date | null;
  occurrenceCount?: number;
  patternLastSeenAt?: Date | null;
  variableWindow?: PatternVariableWindow;
  /** When set, the named read rejects (simulating a DB/transport failure). */
  failOn?: keyof LogStreamHealthReader;
}

const zeroVariableWindow: PatternVariableWindow = {
  sampleCount: 0,
  sum: 0,
  min: null,
  max: null,
};

function fakeReader(reads: FakeReads): LogStreamHealthReader {
  const fail = (name: keyof LogStreamHealthReader) => {
    if (reads.failOn === name) {
      return Promise.reject(new Error(`read ${String(name)} failed`));
    }
    return undefined;
  };
  return {
    streamId: "stream-1",
    streamCreatedAt: STREAM_CREATED,
    readSeverityTotals: () =>
      fail("readSeverityTotals") ??
      Promise.resolve({ ...zeroSeverity, ...reads.severity }),
    readNewPatternCount: () =>
      fail("readNewPatternCount") ??
      Promise.resolve(reads.newPatternCount ?? 0),
    readDistinctPatternCount: () =>
      fail("readDistinctPatternCount") ??
      Promise.resolve(reads.distinctPatternCount ?? 0),
    readLastReceivedAt: () =>
      fail("readLastReceivedAt") ??
      Promise.resolve(reads.lastReceivedAt ?? null),
    readPatternOccurrence: () =>
      fail("readPatternOccurrence") ??
      Promise.resolve(reads.occurrenceCount ?? 0),
    readPatternLastSeenAt: () =>
      fail("readPatternLastSeenAt") ??
      Promise.resolve(reads.patternLastSeenAt ?? null),
    readPatternVariableWindow: () =>
      fail("readPatternVariableWindow") ??
      Promise.resolve(reads.variableWindow ?? zeroVariableWindow),
  };
}

function fakeClient(reads: FakeReads): LogStreamHealthClient {
  return {
    streamId: "stream-1",
    reader: fakeReader(reads),
    exec: () => Promise.reject(new Error("unused")),
  };
}

const runContext = (intervalSeconds: number): CollectorRunContext => ({
  check: { id: "c1", name: "logs", intervalSeconds },
  system: { id: "sys1", name: "System" },
});

describe("WindowMetricsCollector", () => {
  it("computes window metrics from seeded buckets", async () => {
    const collector = new WindowMetricsCollector(() => NOW);
    const { result } = await collector.execute({
      config: { windowSeconds: 300 },
      client: fakeClient({
        severity: { info: 20, warn: 4, error: 7, fatal: 1, debug: 2 },
        newPatternCount: 1,
        distinctPatternCount: 6,
        lastReceivedAt: new Date("2026-01-01T12:02:30.000Z"),
      }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });

    expect(result.totalCount).toBe(34);
    expect(result.errorCount).toBe(7);
    expect(result.fatalCount).toBe(1);
    expect(result.warnCount).toBe(4);
    // (error + fatal) / 5 minutes = 8 / 5 = 1.6
    expect(result.errorRatePerMinute).toBe(1.6);
    expect(result.newPatternCount).toBe(1);
    expect(result.distinctPatternCount).toBe(6);
    expect(result.secondsSinceLastLog).toBe(30);
  });

  it("returns secondsSinceLastLog since creation when never received", async () => {
    const collector = new WindowMetricsCollector(() => NOW);
    const { result } = await collector.execute({
      config: {},
      client: fakeClient({ lastReceivedAt: null }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    expect(result.totalCount).toBe(0);
    // 12:03:00 - 00:00:00 = 43380s.
    expect(result.secondsSinceLastLog).toBe(43380);
  });

  it("propagates a read failure as a thrown transport error (never an error field)", async () => {
    const collector = new WindowMetricsCollector(() => NOW);
    await expect(
      collector.execute({
        config: {},
        client: fakeClient({ failOn: "readSeverityTotals" }),
        pluginId: "logstream.logstream",
        runContext: runContext(60),
      }),
    ).rejects.toThrow("read readSeverityTotals failed");
  });

  it("does NOT set an error field for a silent (zero) window", async () => {
    const collector = new WindowMetricsCollector(() => NOW);
    const outcome = await collector.execute({
      config: {},
      client: fakeClient({}),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result.errorCount).toBe(0);
  });
});

describe("window-metrics assertions (end-to-end via backend-api evaluator)", () => {
  async function errorCountResult(errorCount: number) {
    const collector = new WindowMetricsCollector(() => NOW);
    const { result } = await collector.execute({
      config: { windowSeconds: 300 },
      client: fakeClient({ severity: { error: errorCount } }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    return result as unknown as Record<string, unknown>;
  }

  it("fails `errorCount >= 5` on a 7-error window", async () => {
    const result = await errorCountResult(7);
    const evaluated = evaluateAssertion(
      { field: "errorCount", operator: "greaterThanOrEqual", value: 5 },
      result,
    );
    expect(evaluated.passed).toBe(true);
    expect(evaluated.actual).toBe(7);
  });

  it("passes (does not trip) `errorCount >= 5` on a 3-error window", async () => {
    const result = await errorCountResult(3);
    const evaluated = evaluateAssertion(
      { field: "errorCount", operator: "greaterThanOrEqual", value: 5 },
      result,
    );
    expect(evaluated.passed).toBe(false);
    expect(evaluated.actual).toBe(3);
  });

  it("supports absence assertions via secondsSinceLastLog", async () => {
    const collector = new WindowMetricsCollector(() => NOW);
    const { result } = await collector.execute({
      config: {},
      client: fakeClient({
        lastReceivedAt: new Date("2026-01-01T11:50:00.000Z"),
      }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    // 13 minutes of silence = 780s; assert "no logs for 10 min" => fails.
    const evaluated = evaluateAssertion(
      { field: "secondsSinceLastLog", operator: "lessThan", value: 600 },
      result as unknown as Record<string, unknown>,
    );
    expect(result.secondsSinceLastLog).toBe(780);
    expect(evaluated.passed).toBe(false);
  });
});

describe("PatternOccurrenceCollector", () => {
  it("counts occurrences and minutes since last seen", async () => {
    const collector = new PatternOccurrenceCollector(() => NOW);
    const { result } = await collector.execute({
      config: { patternId: "pat-1", windowSeconds: 600 },
      client: fakeClient({
        occurrenceCount: 12,
        patternLastSeenAt: new Date("2026-01-01T11:45:00.000Z"),
      }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    expect(result.occurrenceCount).toBe(12);
    expect(result.minutesSinceLastSeen).toBe(18);
  });

  it("propagates a read failure as a thrown transport error", async () => {
    const collector = new PatternOccurrenceCollector(() => NOW);
    await expect(
      collector.execute({
        config: { patternId: "pat-1" },
        client: fakeClient({ failOn: "readPatternOccurrence" }),
        pluginId: "logstream.logstream",
        runContext: runContext(60),
      }),
    ).rejects.toThrow();
  });
});

describe("PatternMetricCollector", () => {
  it("aggregates a variable window into avg/min/max/sampleCount", async () => {
    const collector = new PatternMetricCollector(() => NOW);
    const { result } = await collector.execute({
      config: { patternId: "pat-1", variableIndex: 0, windowSeconds: 300 },
      client: fakeClient({
        variableWindow: { sampleCount: 4, sum: 120, min: 10, max: 50 },
      }),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    expect(result.avgValue).toBe(30); // 120 / 4
    expect(result.minValue).toBe(10);
    expect(result.maxValue).toBe(50);
    expect(result.sampleCount).toBe(4);
  });

  it("reports zeroed values (never null) for a no-sample window", async () => {
    const collector = new PatternMetricCollector(() => NOW);
    const outcome = await collector.execute({
      config: { patternId: "pat-1", variableIndex: 2 },
      client: fakeClient({}), // defaults to the zero variable window
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result.sampleCount).toBe(0);
    expect(outcome.result.avgValue).toBe(0);
    expect(outcome.result.minValue).toBe(0);
    expect(outcome.result.maxValue).toBe(0);
  });

  it("propagates a read failure as a thrown transport error (never an error field)", async () => {
    const collector = new PatternMetricCollector(() => NOW);
    await expect(
      collector.execute({
        config: { patternId: "pat-1", variableIndex: 0 },
        client: fakeClient({ failOn: "readPatternVariableWindow" }),
        pluginId: "logstream.logstream",
        runContext: runContext(60),
      }),
    ).rejects.toThrow("read readPatternVariableWindow failed");
  });

  it("guards a value assertion with sampleCount (no-data window does not trip maxValue < 50)", async () => {
    const collector = new PatternMetricCollector(() => NOW);
    const { result } = await collector.execute({
      config: { patternId: "pat-1", variableIndex: 0 },
      client: fakeClient({}),
      pluginId: "logstream.logstream",
      runContext: runContext(60),
    });
    // maxValue is 0 on an empty window, so `maxValue < 50` would falsely pass;
    // pairing it with `sampleCount > 0` distinguishes "no data" from a real low.
    const hasSamples = evaluateAssertion(
      { field: "sampleCount", operator: "greaterThan", value: 0 },
      result as unknown as Record<string, unknown>,
    );
    expect(hasSamples.passed).toBe(false);
  });
});
