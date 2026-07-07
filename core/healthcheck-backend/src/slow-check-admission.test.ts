import { describe, it, expect } from "bun:test";
import {
  evaluateSlowCheckAdmission,
  slowCheckLaneKey,
} from "./slow-check-admission";
import { SuspectLane } from "./suspect-lane";
import type { SlowCheckRuntime } from "./slow-check-config";
import type { RecentRun } from "./slow-check-classifier";

function runtime(overrides: Partial<SlowCheckRuntime> = {}): SlowCheckRuntime {
  return {
    lane: new SuspectLane(1),
    recentRunsLimit: 20,
    classifierParams: {
      consecutiveFailures: 3,
      slowFraction: 0.8,
      recoveryProbeEvery: 5,
    },
    safetyFactor: 1.5,
    absoluteFloorMs: 1000,
    ...overrides,
  };
}

const TIMEOUT = 10_000;

/** A slow transport failure (held its slot ~the full timeout). */
function slowFail(): RecentRun {
  return {
    environmentId: null,
    status: "unhealthy",
    latencyMs: TIMEOUT, // >= slowFraction * timeout
    timestamp: new Date(),
  };
}

/** A healthy run with a given latency. */
function healthy(latencyMs: number): RecentRun {
  return { environmentId: null, status: "healthy", latencyMs, timestamp: new Date() };
}

describe("slowCheckLaneKey", () => {
  it("keys on (config, system, env) with ENV_LESS_KEY for null", () => {
    expect(
      slowCheckLaneKey({ configId: "c", systemId: "s", environmentId: null }),
    ).toBe("c:s:_");
    expect(
      slowCheckLaneKey({ configId: "c", systemId: "s", environmentId: "prod" }),
    ).toBe("c:s:prod");
  });
});

describe("evaluateSlowCheckAdmission", () => {
  it("runs a NON-suspect slice at the full timeout with no lane involvement", () => {
    const rt = runtime();
    const decision = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: [healthy(50), healthy(60)],
      configId: "c",
      systemId: "s",
      environmentId: null,
      executionTimeoutMs: TIMEOUT,
    });
    expect(decision).toEqual({ kind: "run", effectiveTimeoutMs: TIMEOUT });
    // No slot was taken.
    expect(rt.lane.active).toBe(0);
  });

  it("admits a suspect slice and shrinks the timeout toward its healthy baseline", () => {
    const rt = runtime();
    const decision = evaluateSlowCheckAdmission({
      runtime: rt,
      // 3 leading slow failures ⇒ suspect; one healthy sample gives a baseline.
      recentRuns: [slowFail(), slowFail(), slowFail(), healthy(200)],
      configId: "c",
      systemId: "s",
      environmentId: null,
      executionTimeoutMs: TIMEOUT,
    });
    expect(decision.kind).toBe("run");
    if (decision.kind !== "run") return;
    // adaptiveTimeout: max(floor 1000, 200 * 1.5) = 1000, and < configured.
    expect(decision.effectiveTimeoutMs).toBe(1000);
    expect(decision.laneKey).toBe("c:s:_");
    expect(rt.lane.active).toBe(1);
  });

  it("keeps the full timeout on a recovery-probe suspect run", () => {
    const rt = runtime();
    // 5 leading slow failures ⇒ suspect AND a recovery probe (every 5th).
    const decision = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: [
        slowFail(),
        slowFail(),
        slowFail(),
        slowFail(),
        slowFail(),
        healthy(200),
      ],
      configId: "c",
      systemId: "s",
      environmentId: null,
      executionTimeoutMs: TIMEOUT,
    });
    expect(decision.kind).toBe("run");
    if (decision.kind !== "run") return;
    // Recovery probe re-measures at the FULL configured timeout.
    expect(decision.effectiveTimeoutMs).toBe(TIMEOUT);
    expect(decision.laneKey).toBe("c:s:_");
  });

  it("DEFERS a suspect slice when the lane is full (lane_full)", () => {
    const rt = runtime({ lane: new SuspectLane(1) });
    // Fill the single slot with a different slice.
    rt.lane.tryAdmit("other:slice:_");

    const decision = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: [slowFail(), slowFail(), slowFail()],
      configId: "c",
      systemId: "s",
      environmentId: null,
      executionTimeoutMs: TIMEOUT,
    });
    expect(decision).toEqual({ kind: "defer", reason: "lane_full" });
  });

  it("DEFERS a suspect slice already in flight (in_flight, single-flight)", () => {
    const rt = runtime({ lane: new SuspectLane(4) });
    // Same slice already holds a slot (a prior tick still running).
    rt.lane.tryAdmit("c:s:_");

    const decision = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: [slowFail(), slowFail(), slowFail()],
      configId: "c",
      systemId: "s",
      environmentId: null,
      executionTimeoutMs: TIMEOUT,
    });
    expect(decision).toEqual({ kind: "defer", reason: "in_flight" });
  });

  it("classifies per-env: one env suspect, a sibling env healthy in the same runtime", () => {
    const rt = runtime({ lane: new SuspectLane(2) });
    const prodFail = (): RecentRun => ({
      environmentId: "prod",
      status: "unhealthy",
      latencyMs: TIMEOUT,
      timestamp: new Date(),
    });
    const runs: RecentRun[] = [
      prodFail(),
      prodFail(),
      prodFail(),
      { environmentId: "staging", status: "healthy", latencyMs: 40, timestamp: new Date() },
    ];

    const prod = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: runs,
      configId: "c",
      systemId: "s",
      environmentId: "prod",
      executionTimeoutMs: TIMEOUT,
    });
    const staging = evaluateSlowCheckAdmission({
      runtime: rt,
      recentRuns: runs,
      configId: "c",
      systemId: "s",
      environmentId: "staging",
      executionTimeoutMs: TIMEOUT,
    });

    // prod is suspect (admitted, shrunk); staging runs at full timeout, no slot.
    expect(prod.kind).toBe("run");
    if (prod.kind === "run") expect(prod.laneKey).toBe("c:s:prod");
    expect(staging).toEqual({ kind: "run", effectiveTimeoutMs: TIMEOUT });
    // Only the suspect env took a slot.
    expect(rt.lane.active).toBe(1);
  });
});
