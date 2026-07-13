import { describe, it, expect } from "bun:test";
import { classifySilence, SILENCE_THRESHOLD_MS } from "./silence";

const now = new Date("2026-01-01T10:00:00Z");
const justOverThreshold = new Date(now.getTime() - SILENCE_THRESHOLD_MS - 1000);
const recent = new Date(now.getTime() - 60_000);

describe("classifySilence", () => {
  it("never-active stream (null lastReceivedAt) produces nothing", () => {
    expect(
      classifySilence({ lastReceivedAt: null, lastMarker: null, now }),
    ).toBe("none");
  });

  it("emits silence when silent and not already flagged", () => {
    expect(
      classifySilence({
        lastReceivedAt: justOverThreshold,
        lastMarker: null,
        now,
      }),
    ).toBe("emit_silence");
  });

  it("does not re-emit silence when already flagged silent", () => {
    expect(
      classifySilence({
        lastReceivedAt: justOverThreshold,
        lastMarker: "silence",
        now,
      }),
    ).toBe("none");
  });

  it("emits recovered when active again after a silence marker", () => {
    expect(
      classifySilence({ lastReceivedAt: recent, lastMarker: "silence", now }),
    ).toBe("emit_recovered");
  });

  it("does nothing when active and last marker was a recovery", () => {
    expect(
      classifySilence({
        lastReceivedAt: recent,
        lastMarker: "silence_recovered",
        now,
      }),
    ).toBe("none");
  });
});
