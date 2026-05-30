import { describe, it, expect } from "bun:test";
import {
  aggregateWindowedMetrics,
  buildHealthState,
} from "./health-state";

describe("buildHealthState", () => {
  const now = new Date("2026-05-30T12:00:00.000Z");

  it("computes inStatusForMs from inStatusSince relative to now", () => {
    const since = new Date("2026-05-30T11:30:00.000Z"); // 30 min ago
    const state = buildHealthState({
      status: "unhealthy",
      inStatusSince: since,
      inMaintenance: false,
      transitionsInWindow: 0,
      transitionWindowMinutes: 60,
      now,
    });
    expect(state.status).toBe("unhealthy");
    expect(state.inStatusSince).toBe(since);
    expect(state.inStatusForMs).toBe(30 * 60_000);
    expect(state.evaluatedAt).toBe(now);
  });

  it("returns inStatusForMs 0 when inStatusSince is null (fail-safe)", () => {
    const state = buildHealthState({
      status: "healthy",
      inStatusSince: null,
      inMaintenance: false,
      transitionsInWindow: 0,
      transitionWindowMinutes: 60,
      now,
    });
    expect(state.inStatusSince).toBeNull();
    expect(state.inStatusForMs).toBe(0);
  });

  it("clamps negative durations to 0 under clock skew", () => {
    const future = new Date("2026-05-30T12:05:00.000Z");
    const state = buildHealthState({
      status: "degraded",
      inStatusSince: future,
      inMaintenance: false,
      transitionsInWindow: 0,
      transitionWindowMinutes: 60,
      now,
    });
    expect(state.inStatusForMs).toBe(0);
  });

  it("passes through metrics and maintenance flag", () => {
    const state = buildHealthState({
      status: "healthy",
      inStatusSince: null,
      latencyMs: 42,
      avgLatencyMs: 50,
      p95LatencyMs: 120,
      successRate: 0.99,
      lastRunAt: now,
      inMaintenance: true,
      transitionsInWindow: 3,
      transitionWindowMinutes: 60,
      now,
    });
    expect(state.latencyMs).toBe(42);
    expect(state.avgLatencyMs).toBe(50);
    expect(state.p95LatencyMs).toBe(120);
    expect(state.successRate).toBe(0.99);
    expect(state.lastRunAt).toBe(now);
    expect(state.inMaintenance).toBe(true);
    expect(state.transitionsInWindow).toBe(3);
    expect(state.transitionWindowMinutes).toBe(60);
  });
});

describe("aggregateWindowedMetrics", () => {
  it("returns empty object when there are no buckets", () => {
    expect(aggregateWindowedMetrics([])).toEqual({});
  });

  it("computes latency-sum-weighted average, max p95, and success rate", () => {
    const result = aggregateWindowedMetrics([
      { runCount: 10, healthyCount: 9, latencySumMs: 1000, p95LatencyMs: 100 },
      { runCount: 30, healthyCount: 30, latencySumMs: 6000, p95LatencyMs: 200 },
    ]);
    // (1000 + 6000) / (10 + 30) = 175
    expect(result.avgLatencyMs).toBe(175);
    // max p95 across buckets
    expect(result.p95LatencyMs).toBe(200);
    // (9 + 30) / (10 + 30) = 0.975
    expect(result.successRate).toBeCloseTo(0.975, 5);
  });

  it("ignores buckets with null latency for the average but counts them for success rate", () => {
    const result = aggregateWindowedMetrics([
      { runCount: 5, healthyCount: 5, latencySumMs: null, p95LatencyMs: null },
      { runCount: 5, healthyCount: 4, latencySumMs: 500, p95LatencyMs: 80 },
    ]);
    // only the second bucket contributes latency: 500 / 5 = 100
    expect(result.avgLatencyMs).toBe(100);
    expect(result.p95LatencyMs).toBe(80);
    // success rate spans both: 9 / 10
    expect(result.successRate).toBeCloseTo(0.9, 5);
  });

  it("omits avg/p95 when no bucket carries latency", () => {
    const result = aggregateWindowedMetrics([
      { runCount: 3, healthyCount: 2, latencySumMs: null, p95LatencyMs: null },
    ]);
    expect(result.avgLatencyMs).toBeUndefined();
    expect(result.p95LatencyMs).toBeUndefined();
    expect(result.successRate).toBeCloseTo(2 / 3, 5);
  });
});
