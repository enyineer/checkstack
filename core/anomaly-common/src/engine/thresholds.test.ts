import { describe, test, expect } from "bun:test";
import { computeThresholds, isAnomalous } from "./thresholds";

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
      expect(isAnomalous(40, thresholds)).toBe(true);
      expect(isAnomalous(50, thresholds)).toBe(false); // Exactly at threshold is not anomalous
      expect(isAnomalous(60, thresholds)).toBe(false);
    });

    test("detects upper anomalies", () => {
      const thresholds = { upperTrigger: 100 };
      expect(isAnomalous(110, thresholds)).toBe(true);
      expect(isAnomalous(100, thresholds)).toBe(false);
      expect(isAnomalous(90, thresholds)).toBe(false);
    });

    test("detects bidirectional anomalies", () => {
      const thresholds = { lowerTrigger: 20, upperTrigger: 80 };
      expect(isAnomalous(10, thresholds)).toBe(true);
      expect(isAnomalous(50, thresholds)).toBe(false);
      expect(isAnomalous(90, thresholds)).toBe(true);
    });

    test("handles undefined thresholds gracefully", () => {
      const thresholds = {};
      expect(isAnomalous(1000, thresholds)).toBe(false);
      expect(isAnomalous(-1000, thresholds)).toBe(false);
    });
  });
});
