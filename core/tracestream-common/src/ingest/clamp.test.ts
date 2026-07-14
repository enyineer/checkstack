import { describe, it, expect } from "bun:test";
import {
  clampSpanTimes,
  MAX_PAST_LAG_MS,
  MAX_FUTURE_SKEW_MS,
  MAX_SPAN_DURATION_MS,
} from "./clamp";

const OBS = new Date("2026-07-14T12:00:00.000Z");

describe("clampSpanTimes", () => {
  it("keeps an in-window span untouched and derives duration", () => {
    const start = new Date(OBS.getTime() - 5_000);
    const end = new Date(OBS.getTime() - 4_000);
    const r = clampSpanTimes({ startTs: start, endTs: end, observedAt: OBS });
    expect(r.startTs.getTime()).toBe(start.getTime());
    expect(r.durationMs).toBe(1_000);
    expect(r.clamped).toBe(false);
  });

  it("snaps an ancient start forward to the past bound", () => {
    const start = new Date(OBS.getTime() - MAX_PAST_LAG_MS - 60_000);
    const end = new Date(start.getTime() + 10);
    const r = clampSpanTimes({ startTs: start, endTs: end, observedAt: OBS });
    expect(r.startTs.getTime()).toBe(OBS.getTime() - MAX_PAST_LAG_MS);
    expect(r.clamped).toBe(true);
    // Duration is derived from the clamped start, so it floors at 0 here.
    expect(r.durationMs).toBe(0);
  });

  it("snaps a far-future start back to the future bound", () => {
    const start = new Date(OBS.getTime() + MAX_FUTURE_SKEW_MS + 60_000);
    const r = clampSpanTimes({ startTs: start, endTs: start, observedAt: OBS });
    expect(r.startTs.getTime()).toBe(OBS.getTime() + MAX_FUTURE_SKEW_MS);
    expect(r.clamped).toBe(true);
  });

  it("clamps a negative duration (end before start) to 0 and keeps the span", () => {
    const start = new Date(OBS.getTime() - 1_000);
    const end = new Date(OBS.getTime() - 5_000);
    const r = clampSpanTimes({ startTs: start, endTs: end, observedAt: OBS });
    expect(r.durationMs).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("caps an absurd duration at MAX_SPAN_DURATION_MS", () => {
    const start = new Date(OBS.getTime() - 1_000);
    const end = new Date(start.getTime() + MAX_SPAN_DURATION_MS + 10 * 24 * 60 * 60_000);
    const r = clampSpanTimes({ startTs: start, endTs: end, observedAt: OBS });
    expect(r.durationMs).toBe(MAX_SPAN_DURATION_MS);
    expect(r.clamped).toBe(true);
  });

  it("snaps an invalid start to observedAt and a NaN end to 0 duration", () => {
    const r = clampSpanTimes({
      startTs: new Date(Number.NaN),
      endTs: new Date(Number.NaN),
      observedAt: OBS,
    });
    expect(r.startTs.getTime()).toBe(OBS.getTime());
    expect(r.durationMs).toBe(0);
    expect(r.clamped).toBe(true);
  });
});
