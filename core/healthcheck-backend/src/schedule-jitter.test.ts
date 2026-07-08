import { describe, it, expect } from "bun:test";
import {
  computeScheduleJitterSeconds,
  DEFAULT_JITTER_WINDOW_SECONDS,
} from "./schedule-jitter";

describe("computeScheduleJitterSeconds", () => {
  it("is deterministic for the same key + interval", () => {
    const a = computeScheduleJitterSeconds({ key: "sys:cfg", intervalSeconds: 60 });
    const b = computeScheduleJitterSeconds({ key: "sys:cfg", intervalSeconds: 60 });
    expect(a).toBe(b);
  });

  it("stays within [0, min(interval, window))", () => {
    // Short interval: window is the interval itself.
    for (let i = 0; i < 200; i++) {
      const v = computeScheduleJitterSeconds({
        key: `k${i}`,
        intervalSeconds: 10,
      });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
    // Long interval: capped by the default window.
    for (let i = 0; i < 200; i++) {
      const v = computeScheduleJitterSeconds({
        key: `k${i}`,
        intervalSeconds: 3600,
      });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(DEFAULT_JITTER_WINDOW_SECONDS);
    }
  });

  it("spreads a synchronized set across the window (de-clusters)", () => {
    // 50 checks that share an interval must NOT all land on the same offset.
    const offsets = new Set<number>();
    for (let i = 0; i < 50; i++) {
      offsets.add(
        computeScheduleJitterSeconds({
          key: `system-${i}:check-a`,
          intervalSeconds: 60,
        }),
      );
    }
    // Comfortably more than a handful of distinct slots out of a 30s window.
    expect(offsets.size).toBeGreaterThan(10);
  });

  it("returns 0 for a non-positive interval or window", () => {
    expect(
      computeScheduleJitterSeconds({ key: "k", intervalSeconds: 0 }),
    ).toBe(0);
    expect(
      computeScheduleJitterSeconds({
        key: "k",
        intervalSeconds: 60,
        maxWindowSeconds: 0,
      }),
    ).toBe(0);
  });

  it("different keys generally produce different offsets", () => {
    const a = computeScheduleJitterSeconds({ key: "alpha", intervalSeconds: 60 });
    const b = computeScheduleJitterSeconds({ key: "beta", intervalSeconds: 60 });
    // Not a hard guarantee for any two strings, but these two must differ.
    expect(a).not.toBe(b);
  });
});
