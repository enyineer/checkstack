import { describe, it, expect } from "bun:test";
import {
  createTDigest,
  serializeTDigest,
  deserializeTDigest,
  pushValuesIntoState,
  tdigestStateFromValues,
  mergeTDigestStates,
  percentileFromState,
} from "./tdigest";

describe("serialize/deserialize", () => {
  it("round-trips an empty digest to []", () => {
    expect(serializeTDigest(createTDigest())).toEqual([]);
    expect(deserializeTDigest([]).size()).toBe(0);
  });

  it("preserves percentiles across a round-trip", () => {
    const digest = createTDigest();
    for (let i = 1; i <= 100; i++) digest.push(i);
    const restored = deserializeTDigest(serializeTDigest(digest));
    expect(restored.percentile(0.95)).toBeGreaterThanOrEqual(90);
    expect(restored.percentile(0.95)).toBeLessThanOrEqual(100);
  });
});

describe("tdigestStateFromValues / pushValuesIntoState", () => {
  it("returns null for no samples", () => {
    expect(tdigestStateFromValues([])).toBeNull();
  });

  it("builds a digest whose p95 approximates the sample p95", () => {
    const state = tdigestStateFromValues(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    const p95 = percentileFromState({ state, q: 0.95 });
    expect(p95).not.toBeNull();
    expect(p95!).toBeGreaterThanOrEqual(90);
    expect(p95!).toBeLessThanOrEqual(100);
  });

  it("folds new values into an existing state", () => {
    let state = tdigestStateFromValues([1, 2, 3]);
    state = pushValuesIntoState({ state, values: [100, 200, 300] });
    const median = percentileFromState({ state, q: 0.5 });
    expect(median).not.toBeNull();
    // Median of {1,2,3,100,200,300} sits between 3 and 100.
    expect(median!).toBeGreaterThan(3);
    expect(median!).toBeLessThan(200);
  });

  it("starts fresh when the existing state is null/empty", () => {
    const state = pushValuesIntoState({ state: null, values: [5, 5, 5] });
    expect(percentileFromState({ state, q: 0.5 })).toBeCloseTo(5, 0);
  });
});

describe("mergeTDigestStates", () => {
  it("merges disjoint digests so the union p95 is approximated", () => {
    const a = tdigestStateFromValues(
      Array.from({ length: 50 }, (_, i) => i + 1),
    ); // 1..50
    const b = tdigestStateFromValues(
      Array.from({ length: 50 }, (_, i) => i + 51),
    ); // 51..100
    const merged = mergeTDigestStates([a, b]);
    const p95 = percentileFromState({ state: merged, q: 0.95 });
    expect(p95).not.toBeNull();
    expect(p95!).toBeGreaterThanOrEqual(90);
    expect(p95!).toBeLessThanOrEqual(100);
  });

  it("skips null/empty inputs and returns null when all are empty", () => {
    expect(mergeTDigestStates([])).toBeNull();
    expect(mergeTDigestStates([null, undefined, []])).toBeNull();
    const only = tdigestStateFromValues([10, 20, 30]);
    const merged = mergeTDigestStates([null, only, []]);
    expect(percentileFromState({ state: merged, q: 0.5 })).toBeCloseTo(20, 0);
  });
});

describe("percentileFromState", () => {
  it("returns null for an absent or empty digest", () => {
    expect(percentileFromState({ state: null, q: 0.95 })).toBeNull();
    expect(percentileFromState({ state: [], q: 0.95 })).toBeNull();
  });
});
