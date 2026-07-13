import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { computeUserPatternId, buildVariableSample } from "./patterns";
import { createDrainEngine } from "../drain/engine";
import type { Storage } from "../storage";

/**
 * Minimal engine for the id-derivation cross-check: `upsertUserPattern` only
 * derives the id + installs an in-memory cluster; it never touches storage, so a
 * bare double is sound. Cast because a real SafeDatabase needs a live Postgres.
 */
function makeDrainEngine() {
  const builder = { from: () => builder, where: () => Promise.resolve([]) };
  const storage = { db: { select: () => builder } } as unknown as Storage;
  return createDrainEngine({
    storage,
    cacheManager: undefined as never,
    instanceRuntime: undefined as never,
    logger: undefined as never,
  });
}

describe("computeUserPatternId", () => {
  it("hashes sha256(streamId + ' ' + template) - the drain-consistent id", () => {
    const id = computeUserPatternId({ streamId: "s1", template: "user <*>" });
    const expected = createHash("sha256")
      .update("s1")
      .update(" ")
      .update("user <*>")
      .digest("hex");
    expect(id).toBe(expected);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and separates stream id from template", () => {
    // The space separator prevents a boundary collision between the two inputs.
    const a = computeUserPatternId({ streamId: "ab", template: "c <*>" });
    const b = computeUserPatternId({ streamId: "a", template: "bc <*>" });
    expect(a).not.toBe(b);
    expect(computeUserPatternId({ streamId: "s", template: "t" })).toBe(
      computeUserPatternId({ streamId: "s", template: "t" }),
    );
  });

  it("matches the Drain engine's own id derivation (API and drain never drift)", () => {
    // createPattern (API) and upsertUserPattern (drain) must derive the SAME id
    // for the same (streamId, template), or a pod would install a cluster under
    // a different id than the row the API wrote.
    const engine = makeDrainEngine();
    for (const { streamId, template } of [
      { streamId: "stream-1", template: "user logged in <*>" },
      { streamId: "stream-2", template: "latency <*> ms" },
      { streamId: "s", template: "<*>" },
    ]) {
      const { patternId } = engine.upsertUserPattern({ streamId, template });
      expect(computeUserPatternId({ streamId, template })).toBe(patternId);
    }
  });
});

describe("buildVariableSample", () => {
  it("reports no samples and 0 share for a position with no numeric buckets", () => {
    expect(
      buildVariableSample({ varIndex: 1, agg: undefined, totalOccurrences: 50 }),
    ).toEqual({ varIndex: 1, sampleValues: [], numericShare: 0 });
  });

  it("derives min/mean/max samples and a real numericShare", () => {
    const sample = buildVariableSample({
      varIndex: 0,
      agg: { count: 4, sum: 120, min: 10, max: 50 },
      totalOccurrences: 8,
    });
    // mean = 120 / 4 = 30 -> samples [min, mean, max] = 10, 30, 50.
    expect(sample.sampleValues).toEqual(["10", "30", "50"]);
    // 4 numeric samples out of 8 occurrences.
    expect(sample.numericShare).toBe(0.5);
  });

  it("de-duplicates identical min/mean/max and clamps share to 1", () => {
    const sample = buildVariableSample({
      varIndex: 2,
      agg: { count: 3, sum: 15, min: 5, max: 5 },
      totalOccurrences: 2, // fewer than numeric count (cross-window skew)
    });
    expect(sample.sampleValues).toEqual(["5"]);
    expect(sample.numericShare).toBe(1);
  });

  it("formats a fractional mean to two decimals", () => {
    const sample = buildVariableSample({
      varIndex: 0,
      agg: { count: 3, sum: 10, min: 1, max: 6 },
      totalOccurrences: 3,
    });
    // mean = 3.333... -> "3.33"
    expect(sample.sampleValues).toEqual(["1", "3.33", "6"]);
  });
});
