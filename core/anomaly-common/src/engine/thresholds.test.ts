import { describe, test, expect } from "bun:test";
import { computeThresholds, isAnomalous, isCategoricalAnomalous } from "./thresholds";

describe("Anomaly Engine - Thresholds", () => {
  describe("computeThresholds", () => {
    test("higher-is-better generates only lowerTrigger", () => {
      // e.g. success rate. Mean 90, stdDev 5, sensitivity 1 -> margin 15
      // lowerTrigger = 90 - 15 = 75
      const thresholds = computeThresholds(90, 5, "higher-is-better", 1);
      expect(thresholds.lowerTrigger).toBe(75);
      expect(thresholds.upperTrigger).toBeUndefined();
    });

    test("lower-is-better generates only upperTrigger", () => {
      // e.g. latency. Mean 100, stdDev 20, sensitivity 1 -> margin 60
      // upperTrigger = 100 + 60 = 160
      const thresholds = computeThresholds(100, 20, "lower-is-better", 1);
      expect(thresholds.upperTrigger).toBe(160);
      expect(thresholds.lowerTrigger).toBeUndefined();
    });

    test("deviation generates both triggers", () => {
      // e.g. queue size. Mean 50, stdDev 10, sensitivity 1 -> margin 30
      // triggers at 20 and 80
      const thresholds = computeThresholds(50, 10, "deviation", 1);
      expect(thresholds.lowerTrigger).toBe(20);
      expect(thresholds.upperTrigger).toBe(80);
    });

    test("scales margin with sensitivity multiplier", () => {
      // deviation, sensitivity 0.5 (tighter bounds)
      // margin = 3 * 10 * 0.5 = 15 -> triggers at 35 and 65
      const strictThresholds = computeThresholds(50, 10, "deviation", 0.5);
      expect(strictThresholds.lowerTrigger).toBe(35);
      expect(strictThresholds.upperTrigger).toBe(65);

      // deviation, sensitivity 2 (looser bounds)
      // margin = 3 * 10 * 2 = 60 -> triggers at -10 and 110
      const looseThresholds = computeThresholds(50, 10, "deviation", 2);
      expect(looseThresholds.lowerTrigger).toBe(-10);
      expect(looseThresholds.upperTrigger).toBe(110);
    });
  });

  describe("isAnomalous", () => {
    test("detects lower anomalies", () => {
      const thresholds = { lowerTrigger: 50 };
      expect(isAnomalous({ value: 40, mean: 60, thresholds })).toBe(true);
      expect(isAnomalous({ value: 50, mean: 60, thresholds })).toBe(false); // Exactly at threshold is not anomalous
      expect(isAnomalous({ value: 60, mean: 60, thresholds })).toBe(false);
    });

    test("detects upper anomalies", () => {
      const thresholds = { upperTrigger: 100 };
      expect(isAnomalous({ value: 110, mean: 80, thresholds })).toBe(true);
      expect(isAnomalous({ value: 100, mean: 80, thresholds })).toBe(false);
      expect(isAnomalous({ value: 90, mean: 80, thresholds })).toBe(false);
    });

    test("detects bidirectional anomalies", () => {
      const thresholds = { lowerTrigger: 20, upperTrigger: 80 };
      expect(isAnomalous({ value: 10, mean: 50, thresholds })).toBe(true);
      expect(isAnomalous({ value: 50, mean: 50, thresholds })).toBe(false);
      expect(isAnomalous({ value: 90, mean: 50, thresholds })).toBe(true);
    });

    test("handles undefined thresholds gracefully", () => {
      const thresholds = {};
      expect(isAnomalous({ value: 1000, mean: 0, thresholds })).toBe(false);
      expect(isAnomalous({ value: -1000, mean: 0, thresholds })).toBe(false);
    });

    test("absolute floor suppresses statistically-anomalous but practically-tiny swings", () => {
      // 6ms baseline, σ=1 → upperTrigger ≈ 9. Value 20 crosses statistical trigger
      // but Δ=14ms is below the 50ms practical-significance floor → no fire.
      const thresholds = computeThresholds(6, 1, "lower-is-better", 1);
      expect(
        isAnomalous({ value: 20, mean: 6, thresholds, minAbsoluteDelta: 50 }),
      ).toBe(false);
      // Same baseline, value 200ms (Δ=194ms) → fires.
      expect(
        isAnomalous({ value: 200, mean: 6, thresholds, minAbsoluteDelta: 50 }),
      ).toBe(true);
    });

    test("relative floor suppresses small proportional changes", () => {
      // 1000ms baseline, σ=10 → upperTrigger=1030. Value 1100 crosses statistically.
      // Δ=100, Δ/μ=0.1. With minRelativeDelta=0.5 (50%), still doesn't fire.
      const thresholds = computeThresholds(1000, 10, "lower-is-better", 1);
      expect(
        isAnomalous({ value: 1100, mean: 1000, thresholds, minRelativeDelta: 0.5 }),
      ).toBe(false);
      // Value 2000, Δ/μ=1.0 → fires.
      expect(
        isAnomalous({ value: 2000, mean: 1000, thresholds, minRelativeDelta: 0.5 }),
      ).toBe(true);
    });

    test("both floors must clear when both are set", () => {
      const thresholds = computeThresholds(100, 5, "lower-is-better", 1);
      // Δ=20 passes minAbsoluteDelta=10 but Δ/μ=0.2 fails minRelativeDelta=0.5
      expect(
        isAnomalous({
          value: 120,
          mean: 100,
          thresholds,
          minAbsoluteDelta: 10,
          minRelativeDelta: 0.5,
        }),
      ).toBe(false);
      // Δ=80 passes both floors
      expect(
        isAnomalous({
          value: 180,
          mean: 100,
          thresholds,
          minAbsoluteDelta: 10,
          minRelativeDelta: 0.5,
        }),
      ).toBe(true);
    });

    test("floors of 0 are no-ops (backward compatible)", () => {
      const thresholds = { upperTrigger: 100 };
      expect(
        isAnomalous({
          value: 101,
          mean: 50,
          thresholds,
          minAbsoluteDelta: 0,
          minRelativeDelta: 0,
        }),
      ).toBe(true);
    });

    test("relative floor handles mean ≈ 0 without dividing by zero", () => {
      const thresholds = { upperTrigger: 0.01 };
      // mean=0, value=10, Δ=10. Math.max(0, ε)=ε ≈ 2.2e-16. Δ/ε = 4.5e16 → passes.
      expect(
        isAnomalous({
          value: 10,
          mean: 0,
          thresholds,
          minRelativeDelta: 0.5,
        }),
      ).toBe(true);
    });
  });

  describe("isCategoricalAnomalous", () => {
    test("handles undefined baselines safely", () => {
      expect(isCategoricalAnomalous(200, undefined, undefined, 1)).toBe(false);
      expect(isCategoricalAnomalous(200, 200, undefined, 1)).toBe(false);
      expect(isCategoricalAnomalous(200, undefined, 0.9, 1)).toBe(false);
    });

    test("triggers if value deviates and ratio is sufficiently high (sensitivity = 1)", () => {
      // ratio 0.95 > 0.9, deviates
      expect(isCategoricalAnomalous(500, 200, 0.95, 1)).toBe(true);
      // ratio 0.95 > 0.9, no deviation
      expect(isCategoricalAnomalous(200, 200, 0.95, 1)).toBe(false);
    });

    test("ignores deviation if baseline ratio is too noisy (sensitivity = 1)", () => {
      // ratio 0.85 < 0.9
      expect(isCategoricalAnomalous(500, 200, 0.85, 1)).toBe(false);
    });

    test("scales dominance threshold with sensitivity", () => {
      // High sensitivity (0.5) -> tighter bounds, more alerts.
      // Required ratio = 0.9 * 0.5 = 0.45.
      // Even if baseline ratio is 0.50 (very noisy), it still triggers an alert!
      expect(isCategoricalAnomalous(500, 200, 0.50, 0.5)).toBe(true);
      
      // Low sensitivity (2.0) -> looser bounds, fewer alerts.
      // Required ratio = 0.9 * 2.0 = 1.8 -> clamped to 0.99.
      // If baseline ratio is 0.95 (pretty stable but not 99%), it does NOT alert.
      expect(isCategoricalAnomalous(500, 200, 0.95, 2.0)).toBe(false);

      // If baseline ratio is 0.995 (extremely stable), it WILL alert even at sensitivity 2.0.
      expect(isCategoricalAnomalous(500, 200, 0.995, 2.0)).toBe(true);
    });
  });
});
