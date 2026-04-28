import { describe, test, expect } from "bun:test";
import { computeMean, computeStdDev, computeLinearRegressionSlope, computeDominance } from "./baseline";

describe("Anomaly Engine - Baseline Mathematics", () => {
  describe("computeMean", () => {
    test("computes correct mean for standard array", () => {
      expect(computeMean([2, 4, 6, 8])).toBe(5);
      expect(computeMean([1, 1, 1, 1])).toBe(1);
    });

    test("returns 0 for empty array", () => {
      expect(computeMean([])).toBe(0);
    });

    test("handles negative numbers and decimals", () => {
      expect(computeMean([-1.5, 2.5, 0])).toBeCloseTo(0.33333333, 5);
      expect(computeMean([-10, -20, -30])).toBe(-20);
    });
  });

  describe("computeStdDev", () => {
    test("computes correct population standard deviation", () => {
      // Variance = 5, StdDev = sqrt(5) ≈ 2.236
      expect(computeStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0, 5);
      
      // Simple 0,2,4 -> mean 2 -> sum(sq(diff)) = 4+0+4 = 8 -> var = 8/3 = 2.666
      // sqrt(2.666) ≈ 1.63299
      expect(computeStdDev([0, 2, 4])).toBeCloseTo(1.63299, 5);
    });

    test("returns 0 for single item or empty array", () => {
      expect(computeStdDev([5])).toBe(0);
      expect(computeStdDev([])).toBe(0);
    });

    test("uses provided mean to optimize", () => {
      // 0, 2, 4, mean = 2
      expect(computeStdDev([0, 2, 4], 2)).toBeCloseTo(1.63299, 5);
    });
  });

  describe("computeLinearRegressionSlope", () => {
    test("computes correct slope for perfectly linear data", () => {
      expect(computeLinearRegressionSlope([0, 2, 4, 6, 8])).toBe(2);
      expect(computeLinearRegressionSlope([10, 8, 6, 4])).toBe(-2);
      expect(computeLinearRegressionSlope([5, 5, 5, 5])).toBe(0);
    });

    test("computes correct slope for noisy data", () => {
      const values = [1, 3, 2, 4, 5];
      // x: 0,1,2,3,4. mean x: 2. y: 1,3,2,4,5. mean y: 3
      // cov(x,y)/var(x) -> 0.9
      expect(computeLinearRegressionSlope(values)).toBeCloseTo(0.9, 5);
    });

    test("returns 0 for insufficient data", () => {
      expect(computeLinearRegressionSlope([5])).toBe(0);
      expect(computeLinearRegressionSlope([])).toBe(0);
    });
  });

  describe("computeDominance", () => {
    test("computes correct dominance ratio and value", () => {
      const result = computeDominance(["success", "success", "error", "success", "timeout"]);
      expect(result.dominantValue).toBe("success");
      expect(result.dominantRatio).toBe(0.6); // 3 / 5
    });

    test("handles boolean values", () => {
      const result = computeDominance([true, true, false]);
      expect(result.dominantValue).toBe(true);
      expect(result.dominantRatio).toBeCloseTo(0.6667, 4);
    });

    test("returns empty object for empty array", () => {
      const result = computeDominance([]);
      expect(result.dominantValue).toBeUndefined();
      expect(result.dominantRatio).toBeUndefined();
    });

    test("returns first dominant value if tied", () => {
      const result = computeDominance(["a", "b", "a", "b"]);
      // "a" was reached count=2 first
      expect(result.dominantValue).toBe("a");
      expect(result.dominantRatio).toBe(0.5);
    });
  });
});
