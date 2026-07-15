import { describe, it, expect } from "bun:test";
import { DEFAULT_TRACE_STREAM_CONFIG } from "@checkstack/tracestream-common";
import {
  floorToMinute,
  floorToHour,
  pickGrain,
  computeRetentionCutoffs,
} from "./time";

describe("floor helpers", () => {
  it("floors to the minute and hour boundaries", () => {
    const at = new Date("2026-07-14T10:37:42.512Z");
    expect(floorToMinute(at).toISOString()).toBe("2026-07-14T10:37:00.000Z");
    expect(floorToHour(at).toISOString()).toBe("2026-07-14T10:00:00.000Z");
  });
});

describe("pickGrain", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("picks minute for a window inside the minute-retention boundary", () => {
    const from = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
    expect(pickGrain({ from, now, minuteRetentionHours: 48 })).toBe("minute");
  });

  it("picks hour when the window reaches older than the boundary", () => {
    const from = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72h ago
    expect(pickGrain({ from, now, minuteRetentionHours: 48 })).toBe("hour");
  });

  it("picks hour exactly at the boundary edge (from before boundary)", () => {
    const from = new Date(now.getTime() - 48 * 60 * 60 * 1000 - 1);
    expect(pickGrain({ from, now, minuteRetentionHours: 48 })).toBe("hour");
  });
});

describe("computeRetentionCutoffs", () => {
  it("derives each cutoff from the tiered policy", () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const c = computeRetentionCutoffs({
      config: DEFAULT_TRACE_STREAM_CONFIG,
      now,
    });
    const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const days = (d: number) => new Date(now.getTime() - d * 86_400_000);
    // Defaults: hot 6h, retained 7d, summary 30d, minute 48h, hourly 90d.
    expect(c.unretainedSpanCutoff).toEqual(hours(6));
    expect(c.retainedSpanCutoff).toEqual(days(7));
    expect(c.summaryCutoff).toEqual(days(30));
    expect(c.minuteCutoff).toEqual(hours(48));
    expect(c.hourlyCutoff).toEqual(days(90));
  });
});
