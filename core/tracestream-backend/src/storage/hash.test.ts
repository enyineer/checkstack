import { describe, it, expect } from "bun:test";
import { fnv1a32, hashToUnitInterval } from "./hash";

describe("hashToUnitInterval", () => {
  it("is deterministic for the same id", () => {
    for (const id of ["abc", "0f".repeat(16), "trace-123"]) {
      expect(hashToUnitInterval(id)).toBe(hashToUnitInterval(id));
    }
  });

  it("stays within [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const v = hashToUnitInterval(`trace-${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces distinct values for distinct ids (no trivial collisions)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(fnv1a32(`trace-${i}`));
    // FNV-1a over 1000 distinct short strings should have no collisions.
    expect(seen.size).toBe(1000);
  });

  it("is roughly uniform: ~rate fraction fall below a threshold", () => {
    const rate = 0.1;
    const n = 20_000;
    let below = 0;
    for (let i = 0; i < n; i++) {
      if (hashToUnitInterval(`w3c-trace-id-${i}`) < rate) below++;
    }
    const fraction = below / n;
    // Sanity band around the target rate (not a strict statistical test).
    expect(fraction).toBeGreaterThan(rate - 0.03);
    expect(fraction).toBeLessThan(rate + 0.03);
  });
});
