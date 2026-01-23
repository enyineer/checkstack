import { describe, it, expect } from "bun:test";
import {
  mergeCounter,
  mergeAverage,
  mergeRate,
  mergeMinMax,
  mergeCounterStates,
  mergeAverageStates,
  mergeRateStates,
  mergeMinMaxStates,
} from "./incremental-aggregation";

describe("mergeCounter", () => {
  it("creates new counter from undefined", () => {
    const result = mergeCounter(undefined, true);
    expect(result).toEqual({ _type: "counter", count: 1 });
  });

  it("increments existing counter with true", () => {
    const result = mergeCounter({ count: 5 }, true);
    expect(result).toEqual({ _type: "counter", count: 6 });
  });

  it("does not increment with false", () => {
    const result = mergeCounter({ count: 5 }, false);
    expect(result).toEqual({ _type: "counter", count: 5 });
  });

  it("accepts numeric increment", () => {
    const result = mergeCounter({ count: 10 }, 3);
    expect(result).toEqual({ _type: "counter", count: 13 });
  });

  it("handles zero increment", () => {
    const result = mergeCounter({ count: 10 }, 0);
    expect(result).toEqual({ _type: "counter", count: 10 });
  });
});

describe("mergeAverage", () => {
  it("creates new average from undefined with value", () => {
    const result = mergeAverage(undefined, 100);
    expect(result).toEqual({
      _type: "average",
      _sum: 100,
      _count: 1,
      avg: 100,
    });
  });

  it("returns initial state when undefined value passed to undefined", () => {
    const result = mergeAverage(undefined, undefined);
    expect(result).toEqual({ _type: "average", _sum: 0, _count: 0, avg: 0 });
  });

  it("correctly computes average across multiple values", () => {
    let state = mergeAverage(undefined, 100);
    state = mergeAverage(state, 200);
    state = mergeAverage(state, 300);
    expect(state).toEqual({ _type: "average", _sum: 600, _count: 3, avg: 200 });
  });

  it("skips undefined values without affecting count", () => {
    let state = mergeAverage(undefined, 100);
    state = mergeAverage(state, undefined);
    state = mergeAverage(state, 200);
    expect(state).toEqual({ _type: "average", _sum: 300, _count: 2, avg: 150 });
  });

  it("rounds average to 1 decimal place", () => {
    let state = mergeAverage(undefined, 100);
    state = mergeAverage(state, 101);
    // (100 + 101) / 2 = 100.5, rounds to 1 decimal place
    expect(state.avg).toBe(100.5);
  });
});

describe("mergeRate", () => {
  it("creates new rate from undefined with success", () => {
    const result = mergeRate(undefined, true);
    expect(result).toEqual({
      _type: "rate",
      _success: 1,
      _total: 1,
      rate: 100,
    });
  });

  it("creates new rate from undefined with failure", () => {
    const result = mergeRate(undefined, false);
    expect(result).toEqual({ _type: "rate", _success: 0, _total: 1, rate: 0 });
  });

  it("returns initial state when undefined value passed to undefined", () => {
    const result = mergeRate(undefined, undefined);
    expect(result).toEqual({ _type: "rate", _success: 0, _total: 0, rate: 0 });
  });

  it("correctly computes rate across multiple values", () => {
    let state = mergeRate(undefined, true);
    state = mergeRate(state, true);
    state = mergeRate(state, false);
    state = mergeRate(state, true);
    // 3/4 = 75%
    expect(state).toEqual({ _type: "rate", _success: 3, _total: 4, rate: 75 });
  });

  it("skips undefined values without affecting totals", () => {
    let state = mergeRate(undefined, true);
    state = mergeRate(state, undefined);
    state = mergeRate(state, false);
    expect(state).toEqual({ _type: "rate", _success: 1, _total: 2, rate: 50 });
  });
});

describe("mergeMinMax", () => {
  it("creates new min/max from undefined", () => {
    const result = mergeMinMax(undefined, 50);
    expect(result).toEqual({ _type: "minmax", min: 50, max: 50 });
  });

  it("returns initial state when undefined value passed to undefined", () => {
    const result = mergeMinMax(undefined, undefined);
    expect(result).toEqual({ _type: "minmax", min: 0, max: 0 });
  });

  it("updates min when new value is lower", () => {
    let state = mergeMinMax(undefined, 50);
    state = mergeMinMax(state, 30);
    expect(state).toEqual({ _type: "minmax", min: 30, max: 50 });
  });

  it("updates max when new value is higher", () => {
    let state = mergeMinMax(undefined, 50);
    state = mergeMinMax(state, 80);
    expect(state).toEqual({ _type: "minmax", min: 50, max: 80 });
  });

  it("updates both when appropriate", () => {
    let state = mergeMinMax(undefined, 50);
    state = mergeMinMax(state, 20);
    state = mergeMinMax(state, 100);
    state = mergeMinMax(state, 60);
    expect(state).toEqual({ _type: "minmax", min: 20, max: 100 });
  });

  it("skips undefined values", () => {
    let state = mergeMinMax(undefined, 50);
    state = mergeMinMax(state, undefined);
    state = mergeMinMax(state, 30);
    expect(state).toEqual({ _type: "minmax", min: 30, max: 50 });
  });

  it("handles negative values", () => {
    let state = mergeMinMax(undefined, -10);
    state = mergeMinMax(state, -50);
    state = mergeMinMax(state, -5);
    expect(state).toEqual({ _type: "minmax", min: -50, max: -5 });
  });
});

// =============================================================================
// State-Merge Utilities (for combining pre-aggregated states)
// =============================================================================

describe("mergeCounterStates", () => {
  it("combines two counter states", () => {
    const result = mergeCounterStates({ count: 5 }, { count: 3 });
    expect(result).toEqual({ _type: "counter", count: 8 });
  });

  it("handles zero counts", () => {
    const result = mergeCounterStates({ count: 0 }, { count: 10 });
    expect(result).toEqual({ _type: "counter", count: 10 });
  });
});

describe("mergeAverageStates", () => {
  it("correctly merges two average states", () => {
    const a = { _sum: 100, _count: 2, avg: 50 };
    const b = { _sum: 200, _count: 2, avg: 100 };
    const result = mergeAverageStates(a, b);
    expect(result).toEqual({ _type: "average", _sum: 300, _count: 4, avg: 75 });
  });

  it("handles unequal counts", () => {
    const a = { _sum: 100, _count: 1, avg: 100 };
    const b = { _sum: 200, _count: 4, avg: 50 };
    const result = mergeAverageStates(a, b);
    // (100 + 200) / 5 = 60
    expect(result).toEqual({ _type: "average", _sum: 300, _count: 5, avg: 60 });
  });

  it("handles zero count", () => {
    const a = { _sum: 0, _count: 0, avg: 0 };
    const b = { _sum: 100, _count: 2, avg: 50 };
    const result = mergeAverageStates(a, b);
    expect(result).toEqual({ _type: "average", _sum: 100, _count: 2, avg: 50 });
  });
});

describe("mergeRateStates", () => {
  it("correctly merges two rate states", () => {
    const a = { _success: 3, _total: 4, rate: 75 };
    const b = { _success: 7, _total: 10, rate: 70 };
    const result = mergeRateStates(a, b);
    // 10/14 ≈ 71.4% -> rounds to 71
    expect(result).toEqual({
      _type: "rate",
      _success: 10,
      _total: 14,
      rate: 71,
    });
  });

  it("handles zero total", () => {
    const a = { _success: 0, _total: 0, rate: 0 };
    const b = { _success: 5, _total: 10, rate: 50 };
    const result = mergeRateStates(a, b);
    expect(result).toEqual({
      _type: "rate",
      _success: 5,
      _total: 10,
      rate: 50,
    });
  });
});

describe("mergeMinMaxStates", () => {
  it("takes min of mins and max of maxes", () => {
    const a = { min: 10, max: 50 };
    const b = { min: 5, max: 100 };
    const result = mergeMinMaxStates(a, b);
    expect(result).toEqual({ _type: "minmax", min: 5, max: 100 });
  });

  it("handles overlapping ranges", () => {
    const a = { min: 20, max: 60 };
    const b = { min: 40, max: 80 };
    const result = mergeMinMaxStates(a, b);
    expect(result).toEqual({ _type: "minmax", min: 20, max: 80 });
  });
});
