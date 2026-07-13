import { describe, it, expect } from "bun:test";
import { partitionNewSeries } from "./cardinality";

describe("partitionNewSeries", () => {
  it("admits all candidates when there is ample headroom", () => {
    const { admitted, dropped } = partitionNewSeries({
      existingCount: 10,
      cap: 100,
      candidates: ["a", "b", "c"],
    });
    expect(admitted).toEqual(["a", "b", "c"]);
    expect(dropped).toEqual([]);
  });

  it("admits up to the remaining headroom and drops the rest, in order", () => {
    const { admitted, dropped } = partitionNewSeries({
      existingCount: 98,
      cap: 100,
      candidates: ["a", "b", "c", "d"],
    });
    expect(admitted).toEqual(["a", "b"]);
    expect(dropped).toEqual(["c", "d"]);
  });

  it("drops every candidate when the cap is already reached", () => {
    const { admitted, dropped } = partitionNewSeries({
      existingCount: 100,
      cap: 100,
      candidates: ["a", "b"],
    });
    expect(admitted).toEqual([]);
    expect(dropped).toEqual(["a", "b"]);
  });

  it("treats an over-full stream as zero headroom (never negative)", () => {
    const { admitted, dropped } = partitionNewSeries({
      existingCount: 150,
      cap: 100,
      candidates: ["a"],
    });
    expect(admitted).toEqual([]);
    expect(dropped).toEqual(["a"]);
  });

  it("returns empty partitions for no candidates", () => {
    expect(
      partitionNewSeries({ existingCount: 0, cap: 100, candidates: [] }),
    ).toEqual({ admitted: [], dropped: [] });
  });
});
