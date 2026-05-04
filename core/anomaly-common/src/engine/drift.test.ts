import { describe, test, expect } from "bun:test";
import { detectDrift } from "./drift";

describe("Anomaly Engine - Drift Detection", () => {
  describe("trigger condition |slope × n| > threshold × σ × sensitivity", () => {
    test("does not trigger when projected change is below threshold", () => {
      // slope * n = 0.5 * 100 = 50; threshold * σ * sensitivity = 2 * 30 * 1 = 60
      const result = detectDrift({
        slope: 0.5,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(false);
      expect(result.projectedChange).toBe(50);
    });

    test("triggers when projected change exceeds threshold", () => {
      // slope * n = 1 * 100 = 100; threshold * σ * sensitivity = 2 * 30 * 1 = 60
      const result = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(true);
      expect(result.projectedChange).toBe(100);
      expect(result.deviationSigmas).toBeCloseTo(100 / 30, 4);
      expect(result.driftDirection).toBe("above");
    });

    test("uses absolute value of slope so negative drifts also count", () => {
      const result = detectDrift({
        slope: -1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(true);
      expect(result.driftDirection).toBe("below");
    });
  });

  describe("direction filtering", () => {
    test("lower-is-better only flags positive slopes (metric getting worse)", () => {
      const rising = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "lower-is-better",
        sensitivity: 1,
        threshold: 2,
      });
      expect(rising.drifting).toBe(true);

      const falling = detectDrift({
        slope: -1,
        stdDev: 30,
        sampleCount: 100,
        direction: "lower-is-better",
        sensitivity: 1,
        threshold: 2,
      });
      expect(falling.drifting).toBe(false);
    });

    test("higher-is-better only flags negative slopes", () => {
      const falling = detectDrift({
        slope: -1,
        stdDev: 30,
        sampleCount: 100,
        direction: "higher-is-better",
        sensitivity: 1,
        threshold: 2,
      });
      expect(falling.drifting).toBe(true);

      const rising = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "higher-is-better",
        sensitivity: 1,
        threshold: 2,
      });
      expect(rising.drifting).toBe(false);
    });

    test("dominance never triggers drift", () => {
      const result = detectDrift({
        slope: 100,
        stdDev: 1,
        sampleCount: 100,
        direction: "dominance",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(false);
    });
  });

  describe("sensitivity scaling", () => {
    test("higher sensitivity widens the band — fewer detections", () => {
      // Borderline case: slope*n = 60, threshold*σ = 60. With sensitivity 2.0 the band doubles.
      const baseline = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(baseline.drifting).toBe(true);

      const desensitized = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 2,
        threshold: 2,
      });
      expect(desensitized.drifting).toBe(false);
    });

    test("lower sensitivity tightens the band — more detections", () => {
      const dormant = detectDrift({
        slope: 0.5,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(dormant.drifting).toBe(false);

      const sensitive = detectDrift({
        slope: 0.5,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 0.5,
        threshold: 2,
      });
      expect(sensitive.drifting).toBe(true);
    });
  });

  describe("degenerate inputs", () => {
    test("zero stdDev with non-zero slope still drifts (any movement is anomalous)", () => {
      const result = detectDrift({
        slope: 1,
        stdDev: 0,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(true);
      expect(result.deviationSigmas).toBe(Number.POSITIVE_INFINITY);
    });

    test("zero slope never drifts", () => {
      const result = detectDrift({
        slope: 0,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(false);
    });

    test("zero sampleCount never drifts", () => {
      const result = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 0,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(false);
    });

    test("zero stdDev with zero slope does not drift", () => {
      const result = detectDrift({
        slope: 0,
        stdDev: 0,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
      });
      expect(result.drifting).toBe(false);
    });
  });

  describe("practical-significance floors", () => {
    test("absolute floor suppresses drift below the floor", () => {
      // slope*n = 100, statistical band = 60 → would normally drift.
      // But projected change 100 < absolute floor 200 → no drift.
      const suppressed = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        minAbsoluteDelta: 200,
      });
      expect(suppressed.drifting).toBe(false);

      const passes = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        minAbsoluteDelta: 50,
      });
      expect(passes.drifting).toBe(true);
    });

    test("relative floor suppresses drift below the proportional floor", () => {
      // mean=1000, projected change=100 → relative=0.1 (10%).
      // With minRelativeDelta=0.5 (50%), drift suppressed.
      const suppressed = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        mean: 1000,
        minRelativeDelta: 0.5,
      });
      expect(suppressed.drifting).toBe(false);

      // mean=100, same projected change=100 → relative=1.0 → fires.
      const fires = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        mean: 100,
        minRelativeDelta: 0.5,
      });
      expect(fires.drifting).toBe(true);
    });

    test("relative floor without mean is a no-op", () => {
      // No mean provided → relative floor cannot be evaluated, so it doesn't suppress.
      const result = detectDrift({
        slope: 1,
        stdDev: 30,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        minRelativeDelta: 0.99,
      });
      expect(result.drifting).toBe(true);
    });

    test("zero stdDev still respects floors", () => {
      // Without floors, this drifts (any movement on constant metric).
      // With absolute floor above projected change, it's suppressed.
      const result = detectDrift({
        slope: 0.001,
        stdDev: 0,
        sampleCount: 100,
        direction: "deviation",
        sensitivity: 1,
        threshold: 2,
        minAbsoluteDelta: 1,
      });
      expect(result.drifting).toBe(false);
      expect(result.deviationSigmas).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
