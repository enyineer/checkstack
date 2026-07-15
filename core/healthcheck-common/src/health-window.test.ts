import { describe, it, expect } from "bun:test";
import {
  MIN_WINDOW_SECONDS,
  computeSecondsSinceLast,
  computeWindowBounds,
} from "./health-window";
import { FAST_PATH_DEBOUNCE_MS, fastPathJobId } from "./run-queue";

const NOW = new Date("2026-07-14T10:07:42.500Z");

describe("computeWindowBounds", () => {
  it("ends the complete-minute window at the minute containing now and reads one minute further", () => {
    const bounds = computeWindowBounds({
      now: NOW,
      windowSeconds: 300,
      intervalSeconds: 60,
    });
    expect(bounds.to.toISOString()).toBe("2026-07-14T10:07:00.000Z");
    expect(bounds.from.toISOString()).toBe("2026-07-14T10:02:00.000Z");
    expect(bounds.readTo.toISOString()).toBe("2026-07-14T10:08:00.000Z");
    expect(bounds.windowMinutes).toBe(5);
  });

  it("defaults to the check interval and floors to whole minutes", () => {
    const bounds = computeWindowBounds({
      now: NOW,
      windowSeconds: undefined,
      intervalSeconds: 150, // 2.5 minutes -> 2 whole minutes
    });
    expect(bounds.windowMinutes).toBe(2);
  });

  it("clamps degenerate inputs to at least one minute", () => {
    for (const windowSeconds of [0, -5, Number.NaN, 30]) {
      const bounds = computeWindowBounds({
        now: NOW,
        windowSeconds,
        intervalSeconds: 0,
      });
      expect(bounds.windowMinutes).toBe(1);
      expect(bounds.to.getTime() - bounds.from.getTime()).toBe(60_000);
    }
    expect(MIN_WINDOW_SECONDS).toBe(60);
  });
});

describe("computeSecondsSinceLast", () => {
  it("measures from the last receipt, floored to seconds", () => {
    expect(
      computeSecondsSinceLast({
        now: NOW,
        lastAt: new Date(NOW.getTime() - 90_700),
        streamCreatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(90);
  });

  it("falls back to stream creation when nothing was ever received", () => {
    expect(
      computeSecondsSinceLast({
        now: NOW,
        lastAt: null,
        streamCreatedAt: new Date(NOW.getTime() - 5_000),
      }),
    ).toBe(5);
  });

  it("clamps clock skew to zero", () => {
    expect(
      computeSecondsSinceLast({
        now: NOW,
        lastAt: new Date(NOW.getTime() + 30_000),
        streamCreatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(0);
  });
});

describe("fastPathJobId", () => {
  it("is deterministic within a debounce bucket and namespaced by prefix", () => {
    const base = {
      prefix: "logstream-fast",
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      nowMs: 1_000_000_000,
    };
    const a = fastPathJobId(base);
    const b = fastPathJobId({ ...base, nowMs: base.nowMs + 1 });
    expect(a).toBe(b);
    expect(a.startsWith("logstream-fast:c1:s1:_:")).toBe(true);
    // Next bucket -> different id.
    expect(fastPathJobId({ ...base, nowMs: base.nowMs + FAST_PATH_DEBOUNCE_MS })).not.toBe(a);
    // Env is part of the id; prefixes never collide across plugins.
    expect(fastPathJobId({ ...base, environmentId: "env1" })).not.toBe(a);
    expect(fastPathJobId({ ...base, prefix: "tracestream-fast" })).not.toBe(a);
  });
});
