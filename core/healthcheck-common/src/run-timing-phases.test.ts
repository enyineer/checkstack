import { describe, expect, it } from "bun:test";
import {
  buildRunTimingPhases,
  hasGranularTimings,
} from "./run-timing-phases";

describe("buildRunTimingPhases", () => {
  it("renders present granular phases in transport order", () => {
    const phases = buildRunTimingPhases({
      timings: {
        dnsMs: 5,
        connectMs: 12,
        tlsMs: 30,
        waitMs: 80,
        transferMs: 4,
      },
      connectionTimeMs: 47,
      latencyMs: 131,
    });
    expect(phases.map((p) => p.id)).toEqual([
      "dns",
      "connect",
      "tls",
      "wait",
      "transfer",
    ]);
    expect(phases.map((p) => p.label)).toEqual([
      "DNS",
      "Connect",
      "TLS",
      "Wait",
      "Transfer",
    ]);
    expect(phases.map((p) => p.durationMs)).toEqual([5, 12, 30, 80, 4]);
  });

  it("skips absent / zero / non-finite phases but keeps present ones", () => {
    const phases = buildRunTimingPhases({
      timings: {
        connectMs: 10,
        tlsMs: 0,
        waitMs: Number.NaN,
        processingMs: 25,
      },
    });
    expect(phases.map((p) => p.id)).toEqual(["connect", "processing"]);
    expect(phases.map((p) => p.durationMs)).toEqual([10, 25]);
  });

  it("emits processing-only for a non-HTTP connection-based strategy", () => {
    const phases = buildRunTimingPhases({
      timings: { connectMs: 8, processingMs: 40 },
    });
    expect(phases.map((p) => p.id)).toEqual(["connect", "processing"]);
  });

  it("falls back to coarse Connection + Processing when timings are absent", () => {
    const phases = buildRunTimingPhases({
      connectionTimeMs: 20,
      latencyMs: 100,
    });
    expect(phases).toEqual([
      { id: "connection", label: "Connection", durationMs: 20 },
      { id: "processing", label: "Processing", durationMs: 80 },
    ]);
  });

  it("falls back to coarse view when timings object has no positive phase", () => {
    const phases = buildRunTimingPhases({
      timings: { connectMs: 0 },
      connectionTimeMs: 15,
      latencyMs: 60,
    });
    expect(phases.map((p) => p.id)).toEqual(["connection", "processing"]);
    expect(phases.map((p) => p.durationMs)).toEqual([15, 45]);
  });

  it("clamps processing at zero when connection exceeds total (clock skew)", () => {
    const phases = buildRunTimingPhases({
      connectionTimeMs: 120,
      latencyMs: 100,
    });
    expect(phases).toEqual([
      { id: "connection", label: "Connection", durationMs: 100 },
      { id: "processing", label: "Processing", durationMs: 0 },
    ]);
  });

  it("returns empty when neither timings nor a connection/total pair exist", () => {
    expect(buildRunTimingPhases({})).toEqual([]);
    expect(buildRunTimingPhases({ latencyMs: 50 })).toEqual([]);
    expect(buildRunTimingPhases({ connectionTimeMs: 50 })).toEqual([]);
  });
});

describe("hasGranularTimings", () => {
  it("is true when at least one positive phase is present", () => {
    expect(hasGranularTimings({ dnsMs: 3 })).toBe(true);
    expect(hasGranularTimings({ processingMs: 12 })).toBe(true);
  });

  it("is false for undefined / empty / all-zero timings", () => {
    expect(hasGranularTimings(undefined)).toBe(false);
    expect(hasGranularTimings({})).toBe(false);
    expect(hasGranularTimings({ connectMs: 0, tlsMs: 0 })).toBe(false);
  });
});
