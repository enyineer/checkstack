import { describe, it, expect, mock } from "bun:test";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
  type SeverityBand,
  type StreamSeverityTotals,
} from "@checkstack/logstream-common";
import type { ScopedTransaction } from "@checkstack/backend-api";
import type * as schema from "../schema";
import type { Storage, PatternUpsert } from "../storage";
import type { DrainEngine } from "../drain/engine";
import { RawSampler } from "./sampler";
import { prepareFlush, writeFlush, detectSpike, type FlushPlan } from "./flush";

function line(
  band: SeverityBand,
  body: string,
  tsMs = 100 * 60_000,
  observedMs = tsMs,
): IngestedLine {
  return {
    ts: new Date(tsMs),
    observedAt: new Date(observedMs),
    severityNumber: SEVERITY_NUMBER_FOR_BAND[band],
    band,
    body,
  };
}

/** A deterministic Drain stub: patternId = template (digits masked). An optional
 * `wildcards` fn supplies the raw `<*>` values per line body (default none);
 * `setPatternHidden` toggles the flag classifications report, like the real one. */
function mockDrain(wildcards?: (body: string) => string[]): DrainEngine {
  const seen = new Set<string>();
  const pending: PatternUpsert[] = [];
  const hiddenIds = new Set<string>();
  return {
    classify({ streamId, body, severityNumber, at }) {
      const template = body.replace(/\d+/g, "<*>");
      const patternId = `p:${template}`;
      const isNew = !seen.has(patternId);
      if (isNew) {
        seen.add(patternId);
        pending.push({
          id: patternId,
          streamId,
          template,
          tokenCount: template.split(" ").length,
          firstSeenAt: at,
          lastSeenAt: at,
          sampleBody: body,
          totalCount: 1,
          severityMax: severityNumber,
        });
      }
      return {
        patternId,
        isNew,
        template,
        tokenCount: template.split(" ").length,
        severityNumber,
        wildcardValues: wildcards ? wildcards(body) : [],
        hidden: hiddenIds.has(patternId),
      };
    },
    pendingPatternUpserts() {
      const out = [...pending];
      pending.length = 0;
      return out;
    },
    async hydrateStream() {},
    upsertUserPattern({ template }) {
      return { patternId: `p:${template}` };
    },
    removeUserPattern() {},
    setProtectedPatterns() {},
    setPatternHidden({ patternId, hidden }) {
      if (hidden) hiddenIds.add(patternId);
      else hiddenIds.delete(patternId);
    },
  };
}

function mockStorage(sumBands?: (from: Date, to: Date) => StreamSeverityTotals): Storage {
  return {
    upsertPatterns: mock(async () => {}),
    upsertSeverityBuckets: mock(async () => {}),
    upsertPatternBuckets: mock(async () => {}),
    upsertVariableBuckets: mock(async () => {}),
    insertLogEventsBatch: mock(async () => {}),
    touchStreamActivity: mock(async () => {}),
    sumSeverityBands: mock(async ({ from, to }: { from: Date; to: Date }) =>
      sumBands ? sumBands(from, to) : { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
    ),
  } as unknown as Storage;
}

type Tx = ScopedTransaction<typeof schema>;

/** A tx stub whose `select(...)` returns a preset "last spike" row list. */
function mockTx(lastSpike: { ts: Date }[] = []): Tx {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(lastSpike),
  };
  return { select: () => chain } as unknown as Tx;
}

describe("prepareFlush", () => {
  it("folds bucket deltas, worst band, error delta and new-pattern events", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    const lines = [
      line("info", "user 1 logged in"),
      line("info", "user 2 logged in"), // same template -> not new
      line("error", "db timeout after 30 ms"),
    ];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });

    expect(plan.worstBand).toBe("error");
    expect(plan.errorDelta).toBe(1);
    expect(plan.linesClassified).toBe(3);
    // Two templates -> two pattern deltas; severity deltas info(2) + error(1).
    expect(plan.patternDeltas).toHaveLength(2);
    const infoDelta = plan.severityDeltas.find((d) => d.band === "info");
    expect(infoDelta?.count).toBe(2);
    // Only the error line is a new WARN+ pattern.
    expect(plan.newPatternEvents).toHaveLength(1);
    expect(plan.newPatternEvents[0]!.type).toBe("new_pattern");
    expect(plan.patternUpserts).toHaveLength(2);
  });

  it("keeps WARN+ raw rows and samples info per the sampler", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1); // reject random info samples
    const bodies = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const lines = [
      ...bodies.map((b) => line("info", b)),
      line("error", "boom"),
    ];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    // 5 distinct info templates -> each first-seen kept (<=3 rule per pattern),
    // plus the error line always kept.
    const errorRows = plan.eventRows.filter((r) => r.band === "error");
    expect(errorRows).toHaveLength(1);
    expect(plan.eventRows.length).toBe(6);
  });

  it("derives receivedAt from server observedAt, never a future client ts", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    const observedMs = 100 * 60_000;
    // A line whose client `ts` is far in the future but was observed `now`.
    const futureTsMs = observedMs + 365 * 24 * 60 * 60_000;
    const lines = [line("info", "hello", futureTsMs, observedMs)];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(observedMs + 5_000),
      flushIntervalMs: 500,
    });
    // receivedAt tracks the server observation time, NOT the future client ts,
    // so a future-dated line can never pin lastReceivedAt forward.
    expect(plan.receivedAt.getTime()).toBe(observedMs);
  });
});

describe("prepareFlush - severityRules.patternOverrides", () => {
  it("re-bands a pattern for buckets, worst band, warn+ sampling and stored rows", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1); // reject every random info sample
    // 5 info lines of the SAME masked pattern. Without an override the sampler
    // keeps only the first 3 (first-N-per-pattern) and drops the rest; an
    // override to `warn` makes every one WARN+ and thus always kept.
    const lines = Array.from({ length: 5 }, (_, i) => line("info", `job ${i} done`));
    const patternId = "p:job <*> done";
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: {
        ...DEFAULT_LOG_STREAM_CONFIG,
        severityRules: { patternOverrides: [{ patternId, band: "warn" }] },
      },
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });

    // worstBand (the fast-path hook value) reflects the override, not `info`.
    expect(plan.worstBand).toBe("warn");
    // Severity buckets counted under the OVERRIDE band only.
    expect(plan.severityDeltas.find((d) => d.band === "warn")?.count).toBe(5);
    expect(plan.severityDeltas.find((d) => d.band === "info")).toBeUndefined();
    // Sampler treats them as WARN+ -> all five kept (rng rejects info samples).
    expect(plan.eventRows).toHaveLength(5);
    // Stored raw rows carry the override band.
    expect(plan.eventRows.every((r) => r.band === "warn")).toBe(true);
  });

  it("leaves a non-overridden pattern on its source band", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    const lines = [line("info", "alpha"), line("info", "beta")];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: {
        ...DEFAULT_LOG_STREAM_CONFIG,
        severityRules: {
          patternOverrides: [{ patternId: "p:unrelated", band: "error" }],
        },
      },
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    expect(plan.worstBand).toBe("info");
    expect(plan.severityDeltas.find((d) => d.band === "info")?.count).toBe(2);
    expect(plan.errorDelta).toBe(0);
  });
});

describe("prepareFlush - traceExtraction", () => {
  it("populates a native line's traceId from a stream config rule when the line carries no id", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    // An ingested native line WITHOUT reserved trace keys, carrying the id in an
    // attribute and in the body. This mirrors a plain JSON source that never
    // emits W3C ids - the flush seam fills them from the stream's rules.
    const attrLine: IngestedLine = {
      ...line("info", "request done trace=beefBEEF status=200"),
      attributes: { ctx: { trace_id: "4BF9-2B32" } },
    };
    const plan = await prepareFlush({
      streamId: "s1",
      lines: [attrLine],
      drain,
      sampler,
      config: {
        ...DEFAULT_LOG_STREAM_CONFIG,
        traceExtraction: {
          traceId: { attributePaths: ["ctx.trace_id"] },
          spanId: { bodyRegex: "trace=(\\w+)" },
        },
      },
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });

    expect(plan.eventRows).toHaveLength(1);
    // Attribute path resolved + normalized (dash-stripped, lowercased).
    expect(plan.eventRows[0]!.traceId).toBe("4bf92b32");
    // Independent spanId rule extracted from the body, normalized.
    expect(plan.eventRows[0]!.spanId).toBe("beefbeef");
  });

  it("normalizes a carried id and never overwrites it with a rule (OTLP / reserved keys win)", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    const nativeLine: IngestedLine = {
      ...line("info", "trace=frombody"),
      // A dashed/uppercase carried id: it is normalized at the flush seam (so it
      // matches the stored W3C id) but is NOT replaced by the rule.
      traceId: "4BF9-2B32",
      attributes: { ctx: { trace_id: "from-attr" } },
    };
    const plan = await prepareFlush({
      streamId: "s1",
      lines: [nativeLine],
      drain,
      sampler,
      config: {
        ...DEFAULT_LOG_STREAM_CONFIG,
        traceExtraction: {
          traceId: { attributePaths: ["ctx.trace_id"], bodyRegex: "trace=(\\w+)" },
        },
      },
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    expect(plan.eventRows[0]!.traceId).toBe("4bf92b32");
  });

  it("treats a carried empty-string traceId as absent and fills it from the rule", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    // A native source that set traceId to "" (the confirmed empty-string bug):
    // it must NOT persist as '' (unqueryable in the partial index) and must let
    // extraction fill it.
    const nativeLine: IngestedLine = {
      ...line("info", "no id in body"),
      traceId: "",
      attributes: { ctx: { trace_id: "FILLED-FROM-ATTR" } },
    };
    const plan = await prepareFlush({
      streamId: "s1",
      lines: [nativeLine],
      drain,
      sampler,
      config: {
        ...DEFAULT_LOG_STREAM_CONFIG,
        traceExtraction: { traceId: { attributePaths: ["ctx.trace_id"] } },
      },
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    expect(plan.eventRows[0]!.traceId).toBe("filledfromattr");
  });
});

describe("prepareFlush - variable folding", () => {
  it("folds only numeric wildcard values into per-(pattern,varIndex,minute) deltas", async () => {
    // wildcardValues: index 0 is numeric, index 1 is a non-numeric word.
    const drain = mockDrain((body) => {
      const m = body.match(/latency (\S+) route (\S+)/);
      return m ? [m[1]!, m[2]!] : [];
    });
    const sampler = new RawSampler(() => 1);
    // SAME masked pattern for both lines (only the number varies).
    const lines = [
      line("info", "latency 100 route users"),
      line("info", "latency 300 route users"),
    ];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });

    // Only varIndex 0 folds; varIndex 1 ("users") is non-numeric and skipped.
    expect(plan.variableDeltas).toHaveLength(1);
    const delta = plan.variableDeltas[0]!;
    expect(delta.patternId).toBe("p:latency <*> route users");
    expect(delta.varIndex).toBe(0);
    expect(delta.count).toBe(2);
    expect(delta.sum).toBe(400);
    expect(delta.min).toBe(100);
    expect(delta.max).toBe(300);
  });

  it("accepts floats/signs but rejects non-plain numbers (hex, units, Infinity)", async () => {
    const drain = mockDrain((body) => [body]); // whole body is the single value
    const sampler = new RawSampler(() => 1);
    const lines = [
      line("info", "3.5"),
      line("info", "-2"),
      line("info", "0x1f"),
      line("info", "12px"),
      line("info", "Infinity"),
    ];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    // Each distinct body is its own pattern; only "3.5" and "-2" fold.
    const folded = plan.variableDeltas
      .map((d) => d.sum)
      .toSorted((a, b) => a - b);
    expect(folded).toEqual([-2, 3.5]);
  });

  it("folds nothing when the drain yields no wildcard values (default)", async () => {
    const drain = mockDrain();
    const sampler = new RawSampler(() => 1);
    const plan = await prepareFlush({
      streamId: "s1",
      lines: [line("info", "no vars here 1")],
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    expect(plan.variableDeltas).toHaveLength(0);
  });
});

describe("writeFlush", () => {
  const now = new Date(101 * 60_000);
  const basePlan: FlushPlan = {
    streamId: "s1",
    patternUpserts: [],
    severityDeltas: [],
    patternDeltas: [],
    variableDeltas: [],
    eventRows: [],
    droppedByCap: 0,
    worstBand: "info",
    errorDelta: 0,
    linesClassified: 1,
    newPatternEvents: [],
    affectedErrorMinutes: [],
    receivedAt: now,
    rateEstimate: 0,
  };

  it("writes patterns, buckets, events and activity in one pass (no spike reads)", async () => {
    const storage = mockStorage();
    await writeFlush({ tx: mockTx(), plan: basePlan, storage, now });
    expect(storage.upsertPatterns).toHaveBeenCalledTimes(1);
    expect(storage.upsertSeverityBuckets).toHaveBeenCalledTimes(1);
    expect(storage.upsertVariableBuckets).toHaveBeenCalledTimes(1);
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
    expect(storage.touchStreamActivity).toHaveBeenCalledTimes(1);
    // Spike detection is a SEPARATE post-commit read: writeFlush must not query.
    expect(storage.sumSeverityBands).not.toHaveBeenCalled();
  });
});

describe("detectSpike (post-commit read)", () => {
  const now = new Date(101 * 60_000);
  const basePlan: FlushPlan = {
    streamId: "s1",
    patternUpserts: [],
    severityDeltas: [],
    patternDeltas: [],
    variableDeltas: [],
    eventRows: [],
    droppedByCap: 0,
    worstBand: "info",
    errorDelta: 0,
    linesClassified: 1,
    newPatternEvents: [],
    affectedErrorMinutes: [],
    receivedAt: now,
    rateEstimate: 0,
  };

  it("emits a spike when a minute exceeds the absolute floor with no recent spike", async () => {
    const minuteEpoch = 100;
    const storage = mockStorage((from) => {
      // The 30-min trailing window starts well before the minute; the minute
      // window starts exactly at minuteEpoch. Distinguish by `from`.
      if (from.getTime() === minuteEpoch * 60_000) {
        return { trace: 0, debug: 0, info: 0, warn: 0, error: 15, fatal: 0 };
      }
      return { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    });
    const plan: FlushPlan = {
      ...basePlan,
      errorDelta: 15,
      affectedErrorMinutes: [minuteEpoch],
    };
    const spike = await detectSpike({ runner: mockTx([]), plan, storage, now });
    expect(spike).not.toBeNull();
    expect(spike!.type).toBe("spike");
    expect(spike!.detail?.errorFatalCount).toBe(15);
  });

  it("emits a spike on the 4x-trailing-average branch (above the absolute floor)", async () => {
    const minuteEpoch = 100;
    const storage = mockStorage((from) => {
      // Trailing window: 300 error over 30 min -> avg 10/min -> 4x = 40 threshold
      // (dominates the absolute floor of 10). The minute has 45 error -> spike.
      if (from.getTime() === minuteEpoch * 60_000) {
        return { trace: 0, debug: 0, info: 0, warn: 0, error: 45, fatal: 0 };
      }
      return { trace: 0, debug: 0, info: 0, warn: 0, error: 300, fatal: 0 };
    });
    const plan: FlushPlan = {
      ...basePlan,
      errorDelta: 45,
      affectedErrorMinutes: [minuteEpoch],
    };
    const spike = await detectSpike({ runner: mockTx([]), plan, storage, now });
    expect(spike).not.toBeNull();
    expect(spike!.detail?.threshold).toBe(40);
    expect(spike!.detail?.errorFatalCount).toBe(45);
  });

  it("does NOT emit when the minute is below the 4x-trailing-average threshold", async () => {
    const minuteEpoch = 100;
    const storage = mockStorage((from) => {
      // Same trailing avg (threshold 40) but the minute has only 30 error.
      if (from.getTime() === minuteEpoch * 60_000) {
        return { trace: 0, debug: 0, info: 0, warn: 0, error: 30, fatal: 0 };
      }
      return { trace: 0, debug: 0, info: 0, warn: 0, error: 300, fatal: 0 };
    });
    const plan: FlushPlan = {
      ...basePlan,
      errorDelta: 30,
      affectedErrorMinutes: [minuteEpoch],
    };
    const spike = await detectSpike({ runner: mockTx([]), plan, storage, now });
    expect(spike).toBeNull();
  });

  it("suppresses a spike within the 10-minute dedupe window", async () => {
    const minuteEpoch = 100;
    const storage = mockStorage(() => ({
      trace: 0, debug: 0, info: 0, warn: 0, error: 50, fatal: 0,
    }));
    const plan: FlushPlan = {
      ...basePlan,
      errorDelta: 50,
      affectedErrorMinutes: [minuteEpoch],
    };
    // A spike 2 minutes ago -> deduped.
    const recent = [{ ts: new Date(now.getTime() - 2 * 60_000) }];
    const spike = await detectSpike({ runner: mockTx(recent), plan, storage, now });
    expect(spike).toBeNull();
  });
});

describe("prepareFlush - hidden patterns", () => {
  it("skips raw rows for a hidden pattern while every aggregate still counts", async () => {
    const drain = mockDrain();
    // mockDrain derives `p:` + digits-masked body, so both health lines share
    // one pattern id; hide it before the flush.
    drain.setPatternHidden({
      streamId: "s1",
      patternId: "p:GET /health <*>",
      hidden: true,
    });
    const sampler = new RawSampler(() => 1);
    const lines = [
      line("info", "GET /health 200"),
      line("error", "GET /health 503"), // hidden skips even WARN+ raw rows
      line("error", "boom"),
    ];
    const plan = await prepareFlush({
      streamId: "s1",
      lines,
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });

    // Raw store: only the visible pattern's line survives.
    expect(plan.eventRows.map((r) => r.patternId)).toEqual(["p:boom"]);

    // Aggregates: all three lines counted - severity, pattern buckets, worst
    // band and error delta are untouched by hiding.
    const errorDelta = plan.severityDeltas.find((d) => d.band === "error");
    expect(errorDelta?.count).toBe(2);
    const hiddenPattern = plan.patternDeltas.find(
      (d) => d.patternId === "p:GET /health <*>",
    );
    expect(hiddenPattern?.count).toBe(2);
    expect(plan.worstBand).toBe("error");
    expect(plan.errorDelta).toBe(2);
    expect(plan.linesClassified).toBe(3);
  });

  it("resumes raw persistence after an unhide", async () => {
    const drain = mockDrain();
    drain.setPatternHidden({
      streamId: "s1",
      patternId: "p:GET /health <*>",
      hidden: true,
    });
    drain.setPatternHidden({
      streamId: "s1",
      patternId: "p:GET /health <*>",
      hidden: false,
    });
    const sampler = new RawSampler(() => 1);
    const plan = await prepareFlush({
      streamId: "s1",
      lines: [line("error", "GET /health 503")],
      drain,
      sampler,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(100 * 60_000),
      flushIntervalMs: 500,
    });
    expect(plan.eventRows).toHaveLength(1);
  });
});
