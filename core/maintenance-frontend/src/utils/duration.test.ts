import { describe, expect, it } from "bun:test";
import { formatWindowDuration, windowLengthMs } from "./duration";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatWindowDuration", () => {
  it("renders 0m for non-positive spans", () => {
    expect(formatWindowDuration(0)).toBe("0m");
    expect(formatWindowDuration(-5 * MIN)).toBe("0m");
  });

  it("renders < 1m for sub-minute spans", () => {
    expect(formatWindowDuration(45_000)).toBe("< 1m");
  });

  it("renders whole minutes", () => {
    expect(formatWindowDuration(30 * MIN)).toBe("30m");
  });

  it("combines hours and minutes", () => {
    expect(formatWindowDuration(HOUR + 30 * MIN)).toBe("1h 30m");
  });

  it("drops a zero minutes tail", () => {
    expect(formatWindowDuration(2 * HOUR)).toBe("2h");
  });

  it("combines days and hours, capping at two units", () => {
    expect(formatWindowDuration(DAY + 2 * HOUR + 30 * MIN)).toBe("1d 2h");
  });

  it("shows days alone when no remainder", () => {
    expect(formatWindowDuration(3 * DAY)).toBe("3d");
  });

  it("guards against non-finite input", () => {
    expect(formatWindowDuration(Number.NaN)).toBe("0m");
    expect(formatWindowDuration(Number.POSITIVE_INFINITY)).not.toBe("");
  });
});

describe("windowLengthMs", () => {
  it("computes the span between two ISO timestamps", () => {
    expect(
      windowLengthMs({
        startAt: "2026-06-20T10:00:00.000Z",
        endAt: "2026-06-20T12:30:00.000Z",
      }),
    ).toBe(2 * HOUR + 30 * MIN);
  });

  it("clamps inverted ranges to zero", () => {
    expect(
      windowLengthMs({
        startAt: "2026-06-20T12:00:00.000Z",
        endAt: "2026-06-20T10:00:00.000Z",
      }),
    ).toBe(0);
  });

  it("returns 0 for unparseable bounds", () => {
    expect(windowLengthMs({ startAt: "nope", endAt: "also-nope" })).toBe(0);
  });

  it("accepts Date instances", () => {
    expect(
      windowLengthMs({
        startAt: new Date("2026-06-20T10:00:00.000Z"),
        endAt: new Date("2026-06-20T11:00:00.000Z"),
      }),
    ).toBe(HOUR);
  });
});
