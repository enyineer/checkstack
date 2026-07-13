import { describe, it, expect } from "bun:test";
import { floorToMinute, floorToHour, chunk } from "./time";

describe("floorToMinute", () => {
  it("floors to the start of the minute", () => {
    expect(floorToMinute(new Date("2026-07-12T10:35:42.123Z"))).toEqual(
      new Date("2026-07-12T10:35:00.000Z"),
    );
  });
  it("is idempotent on a minute boundary", () => {
    const at = new Date("2026-07-12T10:35:00.000Z");
    expect(floorToMinute(at)).toEqual(at);
  });
});

describe("floorToHour", () => {
  it("floors to the start of the hour", () => {
    expect(floorToHour(new Date("2026-07-12T10:35:42.123Z"))).toEqual(
      new Date("2026-07-12T10:00:00.000Z"),
    );
  });
});

describe("chunk", () => {
  it("splits into chunks of at most size", () => {
    expect(chunk({ items: [1, 2, 3, 4, 5], size: 2 })).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });
  it("returns an empty array for empty input", () => {
    expect(chunk({ items: [], size: 3 })).toEqual([]);
  });
  it("throws for size < 1", () => {
    expect(() => chunk({ items: [1], size: 0 })).toThrow();
  });
});
