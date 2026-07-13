import { describe, it, expect } from "bun:test";
import {
  clampDatapointTs,
  MAX_PAST_LAG_MS,
  MAX_FUTURE_SKEW_MS,
} from "./clamp";

const OBSERVED = new Date("2026-07-12T12:00:00.000Z");

describe("clampDatapointTs", () => {
  it("passes a timestamp inside the trust window through unchanged", () => {
    const ts = new Date(OBSERVED.getTime() - 60_000);
    expect(clampDatapointTs({ ts, observedAt: OBSERVED })).toBe(ts);
  });

  it("snaps an ancient timestamp forward to the past bound", () => {
    const ts = new Date(OBSERVED.getTime() - MAX_PAST_LAG_MS - 60_000);
    const clamped = clampDatapointTs({ ts, observedAt: OBSERVED });
    expect(clamped.getTime()).toBe(OBSERVED.getTime() - MAX_PAST_LAG_MS);
  });

  it("snaps a far-future timestamp back to the future bound", () => {
    const ts = new Date(OBSERVED.getTime() + MAX_FUTURE_SKEW_MS + 60_000);
    const clamped = clampDatapointTs({ ts, observedAt: OBSERVED });
    expect(clamped.getTime()).toBe(OBSERVED.getTime() + MAX_FUTURE_SKEW_MS);
  });

  it("snaps an invalid timestamp to the observation time", () => {
    const clamped = clampDatapointTs({
      ts: new Date(Number.NaN),
      observedAt: OBSERVED,
    });
    expect(clamped.getTime()).toBe(OBSERVED.getTime());
  });

  it("keeps the exact bounds (inclusive)", () => {
    const past = new Date(OBSERVED.getTime() - MAX_PAST_LAG_MS);
    const future = new Date(OBSERVED.getTime() + MAX_FUTURE_SKEW_MS);
    expect(clampDatapointTs({ ts: past, observedAt: OBSERVED })).toBe(past);
    expect(clampDatapointTs({ ts: future, observedAt: OBSERVED })).toBe(future);
  });
});
