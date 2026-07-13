import { describe, it, expect } from "bun:test";
import {
  rollupVariableToHourly,
  type VariableBucketRow,
} from "./variable-buckets";

const H0 = new Date("2026-07-12T10:00:00Z");
const H0b = new Date("2026-07-12T10:30:00Z");
const H1 = new Date("2026-07-12T11:15:00Z");

describe("rollupVariableToHourly", () => {
  it("folds minute rows of the same hour+pattern+var into one hourly row", () => {
    const rows: VariableBucketRow[] = [
      { patternId: "p", varIndex: 0, bucketStart: H0, count: 2, sum: 30, min: 10, max: 20 },
      { patternId: "p", varIndex: 0, bucketStart: H0b, count: 3, sum: 12, min: 1, max: 8 },
    ];
    const out = rollupVariableToHourly(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      patternId: "p",
      varIndex: 0,
      bucketStart: new Date("2026-07-12T10:00:00Z"),
      count: 5,
      sum: 42,
      // sum of counts and sums; min/max are the extrema across the minute rows.
      min: 1,
      max: 20,
    });
  });

  it("keeps distinct hours, patterns and var indexes separate", () => {
    const rows: VariableBucketRow[] = [
      { patternId: "p", varIndex: 0, bucketStart: H0, count: 1, sum: 5, min: 5, max: 5 },
      { patternId: "p", varIndex: 1, bucketStart: H0, count: 1, sum: 9, min: 9, max: 9 },
      { patternId: "q", varIndex: 0, bucketStart: H0, count: 1, sum: 2, min: 2, max: 2 },
      { patternId: "p", varIndex: 0, bucketStart: H1, count: 1, sum: 7, min: 7, max: 7 },
    ];
    const out = rollupVariableToHourly(rows);
    expect(out).toHaveLength(4);
  });

  it("returns nothing for no input", () => {
    expect(rollupVariableToHourly([])).toEqual([]);
  });
});
