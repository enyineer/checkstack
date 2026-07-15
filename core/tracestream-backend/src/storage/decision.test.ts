import { describe, it, expect } from "bun:test";
import { TraceSamplingConfigSchema } from "@checkstack/tracestream-common";
import {
  classifyRetention,
  decideRetention,
  type DecisionCandidate,
} from "./decision";
import { hashToUnitInterval } from "./hash";

function sampling(overrides: Record<string, unknown> = {}) {
  return TraceSamplingConfigSchema.parse(overrides);
}

const HOUR = new Date("2026-07-14T10:00:00.000Z");

function candidate(
  overrides: Partial<DecisionCandidate> & { traceId: string },
): DecisionCandidate {
  return {
    hasError: false,
    durationMs: 0,
    startTs: HOUR,
    ...overrides,
  };
}

describe("classifyRetention", () => {
  it("retains error traces when keepErrorTraces is on (over everything else)", () => {
    const v = classifyRetention({
      candidate: candidate({ traceId: "e", hasError: true, durationMs: 1 }),
      sampling: sampling({ keepErrorTraces: true, baselineSampleRate: 0 }),
    });
    expect(v).toEqual({ traceId: "e", retained: true, reason: "error" });
  });

  it("does NOT special-case errors when keepErrorTraces is off", () => {
    const v = classifyRetention({
      candidate: candidate({ traceId: "e", hasError: true, durationMs: 1 }),
      sampling: sampling({
        keepErrorTraces: false,
        slowTraceThresholdMs: null,
        baselineSampleRate: 0,
      }),
    });
    expect(v.retained).toBe(false);
    expect(v.reason).toBe("sampled_out");
  });

  it("retains slow traces at/over the threshold and not below", () => {
    const s = sampling({
      keepErrorTraces: false,
      slowTraceThresholdMs: 1000,
      baselineSampleRate: 0,
    });
    expect(
      classifyRetention({
        candidate: candidate({ traceId: "s", durationMs: 1000 }),
        sampling: s,
      }).reason,
    ).toBe("slow");
    expect(
      classifyRetention({
        candidate: candidate({ traceId: "s", durationMs: 999 }),
        sampling: s,
      }).retained,
    ).toBe(false);
  });

  it("disables the slow rule when slowTraceThresholdMs is null", () => {
    const v = classifyRetention({
      candidate: candidate({ traceId: "s", durationMs: 10_000_000 }),
      sampling: sampling({
        keepErrorTraces: false,
        slowTraceThresholdMs: null,
        baselineSampleRate: 0,
      }),
    });
    expect(v.retained).toBe(false);
  });

  it("baseline-samples by the deterministic trace-id hash", () => {
    // rate 1 keeps everything, rate 0 keeps nothing (both via the baseline path).
    expect(
      classifyRetention({
        candidate: candidate({ traceId: "abc" }),
        sampling: sampling({
          keepErrorTraces: false,
          slowTraceThresholdMs: null,
          baselineSampleRate: 1,
        }),
      }),
    ).toMatchObject({ retained: true, reason: "baseline" });
    expect(
      classifyRetention({
        candidate: candidate({ traceId: "abc" }),
        sampling: sampling({
          keepErrorTraces: false,
          slowTraceThresholdMs: null,
          baselineSampleRate: 0,
        }),
      }),
    ).toMatchObject({ retained: false, reason: "sampled_out" });
  });

  it("keeps exactly the ids whose hash is below the rate", () => {
    const rate = 0.5;
    const s = sampling({
      keepErrorTraces: false,
      slowTraceThresholdMs: null,
      baselineSampleRate: rate,
    });
    for (const id of ["t1", "t2", "trace-xyz", "0f".repeat(16)]) {
      const expected = hashToUnitInterval(id) < rate;
      expect(
        classifyRetention({ candidate: candidate({ traceId: id }), sampling: s })
          .retained,
      ).toBe(expected);
    }
  });
});

describe("decideRetention (per-hour budget)", () => {
  const noSlowNoErr = {
    keepErrorTraces: false,
    slowTraceThresholdMs: null,
  };

  it("is deterministic across repeated runs", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ traceId: `trace-${i}` }),
    );
    const s = sampling({ ...noSlowNoErr, baselineSampleRate: 0.5 });
    const a = decideRetention({ candidates, sampling: s });
    const b = decideRetention({ candidates, sampling: s });
    expect(a).toEqual(b);
  });

  it("demotes baseline traces past the hourly cap, keeping error/slow over it", () => {
    const s = sampling({
      keepErrorTraces: true,
      slowTraceThresholdMs: 1000,
      baselineSampleRate: 1, // every non-error/non-slow trace is baseline-kept
      maxRetainedTracesPerHour: 1,
    });
    const candidates: DecisionCandidate[] = [
      candidate({ traceId: "b1" }), // baseline -> fills the budget
      candidate({ traceId: "b2" }), // baseline -> over budget
      candidate({ traceId: "err", hasError: true }), // never demoted
      candidate({ traceId: "slow", durationMs: 5000 }), // never demoted
    ];
    const verdicts = decideRetention({ candidates, sampling: s });
    const byId = new Map(verdicts.map((v) => [v.traceId, v]));
    expect(byId.get("b1")).toMatchObject({ retained: true, reason: "baseline" });
    expect(byId.get("b2")).toMatchObject({
      retained: false,
      reason: "over_budget",
    });
    expect(byId.get("err")).toMatchObject({ retained: true, reason: "error" });
    expect(byId.get("slow")).toMatchObject({ retained: true, reason: "slow" });
  });

  it("seeds the budget from already-retained traces in the hour", () => {
    const s = sampling({
      ...noSlowNoErr,
      baselineSampleRate: 1,
      maxRetainedTracesPerHour: 2,
    });
    const retainedByHour = new Map([[HOUR.getTime(), 2]]); // already at cap
    const verdicts = decideRetention({
      candidates: [candidate({ traceId: "b1" })],
      sampling: s,
      retainedByHour,
    });
    expect(verdicts[0]).toMatchObject({
      retained: false,
      reason: "over_budget",
    });
  });

  it("applies no ceiling when maxRetainedTracesPerHour is null", () => {
    const s = sampling({
      ...noSlowNoErr,
      baselineSampleRate: 1,
      maxRetainedTracesPerHour: null,
    });
    const candidates = Array.from({ length: 50 }, (_, i) =>
      candidate({ traceId: `b${i}` }),
    );
    const verdicts = decideRetention({ candidates, sampling: s });
    expect(verdicts.every((v) => v.retained)).toBe(true);
  });
});
