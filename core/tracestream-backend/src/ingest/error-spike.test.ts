import { describe, it, expect } from "bun:test";
import type { Storage } from "../storage";
import { floorToMinute } from "../storage";
import {
  evaluateErrorSpike,
  detectErrorSpike,
  createErrorSpikeDetector,
  SPIKE_DEDUPE_MS,
  SPIKE_MIN_ABSOLUTE,
  SPIKE_MULTIPLIER,
} from "./error-spike";

const STREAM = "stream-1";
const NOW = new Date("2026-01-01T12:03:30.000Z");
const MINUTE_START = floorToMinute(NOW);

describe("evaluateErrorSpike", () => {
  it("fires when the current minute meets the absolute floor (quiet trailing)", () => {
    const event = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: SPIKE_MIN_ABSOLUTE,
      trailingErrorSpans: 0,
      lastSpikeAt: null,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("error_spike");
    expect(event?.ts).toEqual(MINUTE_START);
    expect(event?.detail?.errorSpanCount).toBe(SPIKE_MIN_ABSOLUTE);
  });

  it("does not fire below the absolute floor", () => {
    const event = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: SPIKE_MIN_ABSOLUTE - 1,
      trailingErrorSpans: 0,
      lastSpikeAt: null,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).toBeNull();
  });

  it("uses the trailing multiple as the threshold when it dominates the floor", () => {
    // trailing 900 spans over 30 min = 30/min avg; threshold = 4 * 30 = 120.
    const trailingErrorSpans = 900;
    const threshold = SPIKE_MULTIPLIER * (trailingErrorSpans / 30);
    expect(threshold).toBe(120);

    const below = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: 100,
      trailingErrorSpans,
      lastSpikeAt: null,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(below).toBeNull();

    const above = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: 130,
      trailingErrorSpans,
      lastSpikeAt: null,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(above).not.toBeNull();
    expect(above?.detail?.threshold).toBe(120);
  });

  it("suppresses a spike within the dedupe window of the last one", () => {
    const event = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: 1000,
      trailingErrorSpans: 0,
      lastSpikeAt: new Date(NOW.getTime() - 2 * 60_000),
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).toBeNull();
  });

  it("fires again once the dedupe window has elapsed", () => {
    const event = evaluateErrorSpike({
      streamId: STREAM,
      currentMinuteErrorSpans: 50,
      trailingErrorSpans: 0,
      lastSpikeAt: new Date(NOW.getTime() - 11 * 60_000),
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).not.toBeNull();
  });
});

/**
 * Storage stub exposing only what detectErrorSpike reads: `importantEvents
 * .lastEventAt` and `opBuckets.sumWindowCounts`. The current-minute read is
 * distinguished from the trailing read by its `from` bound (== the affected
 * `minuteStart`). Counts calls so the pod-local gate can be verified. Casts the
 * partial stub to Storage (only these two ports are touched).
 */
function fakeStorage({
  lastSpikeAt,
  trailingErrorSpans,
  currentMinuteErrorSpans,
  minuteStart = MINUTE_START,
}: {
  lastSpikeAt: Date | null;
  trailingErrorSpans: number;
  currentMinuteErrorSpans: number;
  minuteStart?: Date;
}): {
  storage: Storage;
  sumCalls: () => number;
  lastEventCalls: () => number;
} {
  let sumCalls = 0;
  let lastEventCalls = 0;
  const storage = {
    importantEvents: {
      lastEventAt: async () => {
        lastEventCalls += 1;
        return lastSpikeAt;
      },
    },
    opBuckets: {
      sumWindowCounts: async ({ from }: { from: Date }) => {
        sumCalls += 1;
        const isCurrentMinute = from.getTime() === minuteStart.getTime();
        return {
          spanCount: isCurrentMinute ? currentMinuteErrorSpans : trailingErrorSpans,
          errorSpanCount: isCurrentMinute
            ? currentMinuteErrorSpans
            : trailingErrorSpans,
        };
      },
    },
  } as unknown as Storage;
  return {
    storage,
    sumCalls: () => sumCalls,
    lastEventCalls: () => lastEventCalls,
  };
}

describe("detectErrorSpike", () => {
  it("reads the durable counts and returns a spike event when over threshold", async () => {
    const { storage, sumCalls } = fakeStorage({
      lastSpikeAt: null,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 40,
    });
    const { event } = await detectErrorSpike({
      storage,
      streamId: STREAM,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("error_spike");
    // Read both the trailing window and the affected minute (post-commit reads).
    expect(sumCalls()).toBe(2);
  });

  it("evaluates the AFFECTED minute (span-time), not the wall clock", async () => {
    // The burst landed 90s before `now` (export lag): the affected op-bucket
    // minute is 2 minutes back, and floorToMinute(now) would read a fresh empty
    // one. detectErrorSpike must read the affected minute and fire.
    const affectedMinute = floorToMinute(new Date(NOW.getTime() - 90_000));
    expect(affectedMinute.getTime()).not.toBe(MINUTE_START.getTime());
    const { storage } = fakeStorage({
      lastSpikeAt: null,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 50,
      minuteStart: affectedMinute,
    });
    const { event } = await detectErrorSpike({
      storage,
      streamId: STREAM,
      now: NOW,
      minuteStart: affectedMinute,
    });
    expect(event).not.toBeNull();
    expect(event?.ts).toEqual(affectedMinute);
  });

  it("returns null (no spike) for a normal minute", async () => {
    const { storage } = fakeStorage({
      lastSpikeAt: null,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 2,
    });
    const { event } = await detectErrorSpike({
      storage,
      streamId: STREAM,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).toBeNull();
  });

  it("short-circuits on the dedupe gate WITHOUT reading counts, and reports the suppression horizon", async () => {
    const lastSpikeAt = new Date(NOW.getTime() - 60_000);
    const { storage, sumCalls } = fakeStorage({
      lastSpikeAt,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 1000,
    });
    const { event, suppressedUntilMs } = await detectErrorSpike({
      storage,
      streamId: STREAM,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(event).toBeNull();
    expect(sumCalls()).toBe(0);
    expect(suppressedUntilMs).toBe(lastSpikeAt.getTime() + SPIKE_DEDUPE_MS);
  });
});

describe("createErrorSpikeDetector (pod-local dedupe gate)", () => {
  it("skips the dedupe SELECT on subsequent flushes while suppressed", async () => {
    const lastSpikeAt = new Date(NOW.getTime() - 60_000);
    const { storage, lastEventCalls } = fakeStorage({
      lastSpikeAt,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 1000,
    });
    const detector = createErrorSpikeDetector({ storage });

    // First flush: reads lastEventAt, finds a recent spike, caches the horizon.
    const first = await detector.detect({
      streamId: STREAM,
      now: NOW,
      minuteStart: MINUTE_START,
    });
    expect(first).toBeNull();
    expect(lastEventCalls()).toBe(1);

    // Second flush a minute later, still inside the dedupe window: NO new SELECT.
    const second = await detector.detect({
      streamId: STREAM,
      now: new Date(NOW.getTime() + 60_000),
      minuteStart: MINUTE_START,
    });
    expect(second).toBeNull();
    expect(lastEventCalls()).toBe(1);
  });

  it("keeps checking every flush when no prior spike is active", async () => {
    const { storage, lastEventCalls } = fakeStorage({
      lastSpikeAt: null,
      trailingErrorSpans: 0,
      currentMinuteErrorSpans: 1,
    });
    const detector = createErrorSpikeDetector({ storage });
    await detector.detect({ streamId: STREAM, now: NOW, minuteStart: MINUTE_START });
    await detector.detect({
      streamId: STREAM,
      now: new Date(NOW.getTime() + 1000),
      minuteStart: MINUTE_START,
    });
    // No cached horizon (suppressedUntilMs null), so both flushes SELECT.
    expect(lastEventCalls()).toBe(2);
  });
});
