import { describe, it, expect } from "bun:test";
import { isWithinWindow, windowStart } from "./window";

const NOW = new Date("2026-07-14T12:00:00.000Z");

describe("windowStart", () => {
  it("subtracts lookbackSeconds from now", () => {
    expect(
      windowStart({ now: NOW, lookbackSeconds: 90 }).toISOString(),
    ).toBe("2026-07-14T11:58:30.000Z");
  });
});

describe("isWithinWindow", () => {
  const within = (iso: string, lookbackSeconds = 90) =>
    isWithinWindow({ ts: new Date(iso), now: NOW, lookbackSeconds });

  it("includes events newer than the window start", () => {
    expect(within("2026-07-14T11:59:00.000Z")).toBe(true);
    expect(within("2026-07-14T12:00:00.000Z")).toBe(true);
  });

  it("excludes events at or before the exclusive window start", () => {
    // Exactly windowStart (now - 90s) is excluded.
    expect(within("2026-07-14T11:58:30.000Z")).toBe(false);
    expect(within("2026-07-14T11:58:29.999Z")).toBe(false);
    expect(within("2026-07-14T11:00:00.000Z")).toBe(false);
  });

  it("includes future-skewed events (no upper bound)", () => {
    expect(within("2026-07-14T12:05:00.000Z")).toBe(true);
  });
});
