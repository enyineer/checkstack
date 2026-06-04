import { describe, it, expect } from "bun:test";
import { diffSystemEnvironments } from "./environment-membership";

describe("diffSystemEnvironments", () => {
  it("adds desired ids that are not currently linked", () => {
    const diff = diffSystemEnvironments({
      current: ["a"],
      desired: ["a", "b", "c"],
    });
    expect(diff.toAdd.sort()).toEqual(["b", "c"]);
    expect(diff.toRemove).toEqual([]);
  });

  it("removes current ids no longer desired", () => {
    const diff = diffSystemEnvironments({
      current: ["a", "b", "c"],
      desired: ["a"],
    });
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove.sort()).toEqual(["b", "c"]);
  });

  it("computes add and remove together", () => {
    const diff = diffSystemEnvironments({
      current: ["a", "b"],
      desired: ["b", "c"],
    });
    expect(diff.toAdd).toEqual(["c"]);
    expect(diff.toRemove).toEqual(["a"]);
  });

  it("is a no-op when the sets match (order-independent)", () => {
    const diff = diffSystemEnvironments({
      current: ["a", "b"],
      desired: ["b", "a"],
    });
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });

  it("clears all membership when desired is empty", () => {
    const diff = diffSystemEnvironments({
      current: ["a", "b"],
      desired: [],
    });
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove.sort()).toEqual(["a", "b"]);
  });

  it("adds all when current is empty", () => {
    const diff = diffSystemEnvironments({
      current: [],
      desired: ["a", "b"],
    });
    expect(diff.toAdd.sort()).toEqual(["a", "b"]);
    expect(diff.toRemove).toEqual([]);
  });

  it("de-duplicates the desired set", () => {
    const diff = diffSystemEnvironments({
      current: [],
      desired: ["a", "a", "b"],
    });
    expect(diff.toAdd.sort()).toEqual(["a", "b"]);
  });
});
