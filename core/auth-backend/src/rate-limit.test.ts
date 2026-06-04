import { describe, expect, test } from "bun:test";
import { windowStartFor } from "./rate-limit";

describe("windowStartFor", () => {
  test("floors a timestamp to the start of its fixed window", () => {
    const now = new Date("2026-06-02T10:17:42.000Z");
    const start = windowStartFor({ now, windowSeconds: 3600 });
    expect(start.toISOString()).toBe("2026-06-02T10:00:00.000Z");
  });

  test("two timestamps in the same window share a window start (one counter)", () => {
    const a = windowStartFor({
      now: new Date("2026-06-02T10:00:01.000Z"),
      windowSeconds: 3600,
    });
    const b = windowStartFor({
      now: new Date("2026-06-02T10:59:59.000Z"),
      windowSeconds: 3600,
    });
    expect(a.getTime()).toBe(b.getTime());
  });

  test("the next window gets a distinct start (counter resets)", () => {
    const a = windowStartFor({
      now: new Date("2026-06-02T10:59:59.000Z"),
      windowSeconds: 3600,
    });
    const b = windowStartFor({
      now: new Date("2026-06-02T11:00:00.000Z"),
      windowSeconds: 3600,
    });
    expect(b.getTime()).toBeGreaterThan(a.getTime());
  });
});
