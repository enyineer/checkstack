import { describe, it, expect } from "bun:test";
import { resolveGrain, MINUTE_TIER_MAX_MS } from "./grain";

describe("resolveGrain", () => {
  const base = new Date("2026-01-01T00:00:00Z");
  const plus = (ms: number) => new Date(base.getTime() + ms);

  it("an explicit grain always wins, regardless of window width", () => {
    expect(
      resolveGrain({ from: base, to: plus(365 * 24 * 3_600_000), explicit: "minute" }),
    ).toBe("minute");
    expect(resolveGrain({ from: base, to: plus(1000), explicit: "hour" })).toBe("hour");
  });

  it("picks minute for a window at or below the 48h boundary", () => {
    expect(resolveGrain({ from: base, to: plus(3_600_000) })).toBe("minute");
    expect(resolveGrain({ from: base, to: plus(MINUTE_TIER_MAX_MS) })).toBe("minute");
  });

  it("falls back to hour just past the boundary", () => {
    expect(resolveGrain({ from: base, to: plus(MINUTE_TIER_MAX_MS + 1) })).toBe("hour");
  });

  it("uses a 48h minute-tier boundary", () => {
    expect(MINUTE_TIER_MAX_MS).toBe(48 * 3_600_000);
  });
});
