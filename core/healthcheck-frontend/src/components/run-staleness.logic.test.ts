import { describe, expect, test } from "bun:test";
import {
  isRunStale,
  staleAfterMs,
  STALE_MIN_SILENCE_MS,
  STALE_MISSED_INTERVALS,
} from "./run-staleness.logic";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);

describe("staleAfterMs", () => {
  test("scales with the interval for a slow check", () => {
    const intervalSeconds = 600;
    expect(staleAfterMs({ intervalSeconds })).toBe(
      intervalSeconds * 1000 * STALE_MISSED_INTERVALS,
    );
  });

  test("floors at the minimum silence for a fast check", () => {
    // A 10s check would otherwise be "stale" after 50 seconds, which is within
    // the noise of one slow tick.
    expect(staleAfterMs({ intervalSeconds: 10 })).toBe(STALE_MIN_SILENCE_MS);
  });
});

describe("isRunStale", () => {
  test("a recent run is not stale", () => {
    expect(
      isRunStale({
        lastRunAt: agoMs(30_000),
        intervalSeconds: 60,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a long-silent check is stale", () => {
    expect(
      isRunStale({
        lastRunAt: agoMs(STALE_MIN_SILENCE_MS + 60_000),
        intervalSeconds: 60,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a check that never ran is NOT stale", () => {
    // "Never" is already honest on its own; calling it stale would imply it
    // used to work.
    expect(isRunStale({ intervalSeconds: 60, now: NOW })).toBe(false);
  });

  test("a paused check is never stale, however long it has been quiet", () => {
    // It is quiet on purpose. Warning about it would train operators to ignore
    // the warning.
    expect(
      isRunStale({
        lastRunAt: agoMs(30 * 24 * 60 * 60 * 1000),
        intervalSeconds: 60,
        paused: true,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("exactly at the window is not yet stale", () => {
    const intervalSeconds = 600;
    expect(
      isRunStale({
        lastRunAt: agoMs(staleAfterMs({ intervalSeconds })),
        intervalSeconds,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("one millisecond past the window is stale", () => {
    const intervalSeconds = 600;
    expect(
      isRunStale({
        lastRunAt: agoMs(staleAfterMs({ intervalSeconds }) + 1),
        intervalSeconds,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a slow check gets proportionally more grace than a fast one", () => {
    const silence = 45 * 60 * 1000;

    expect(isRunStale({ lastRunAt: agoMs(silence), intervalSeconds: 60, now: NOW })).toBe(
      true,
    );
    // A 30-minute check has not missed five intervals yet.
    expect(
      isRunStale({ lastRunAt: agoMs(silence), intervalSeconds: 1800, now: NOW }),
    ).toBe(false);
  });
});

describe("isRunStale - retired slices must never warn", () => {
  /**
   * The class of bug these guard: an operator RETIRES something on purpose -
   * removes an environment, unassigns a satellite - and the UI immediately
   * warns them about the thing they just retired. Do that a few times and the
   * badge gets ignored, which defeats the point of having it.
   */
  const longSilence = {
    lastRunAt: agoMs(30 * 24 * 60 * 60 * 1000),
    intervalSeconds: 60,
    now: NOW,
  };

  test("an orphaned slice is never stale, however long it has been quiet", () => {
    expect(isRunStale({ ...longSilence, orphaned: true })).toBe(false);
  });

  test("removing a satellite from an assignment does not make its slice stale", () => {
    // The satellite's source slice is marked orphaned once it stops being
    // assigned. It is quiet because it is finished.
    expect(
      isRunStale({
        lastRunAt: agoMs(2 * 60 * 60 * 1000),
        intervalSeconds: 60,
        orphaned: true,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("removing an environment from a system does not make its slice stale", () => {
    expect(
      isRunStale({
        lastRunAt: agoMs(7 * 24 * 60 * 60 * 1000),
        intervalSeconds: 300,
        orphaned: true,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("orphaned wins even when the slice is ALSO paused", () => {
    expect(
      isRunStale({ ...longSilence, orphaned: true, paused: true }),
    ).toBe(false);
  });

  test("a LIVE slice with the same silence IS still stale", () => {
    // The guard must not swallow the real signal: identical inputs, only
    // `orphaned` differs.
    expect(isRunStale({ ...longSilence, orphaned: false })).toBe(true);
    expect(isRunStale(longSilence)).toBe(true);
  });

  test("an orphaned slice that never ran is also not stale", () => {
    expect(
      isRunStale({ intervalSeconds: 60, orphaned: true, now: NOW }),
    ).toBe(false);
  });
});
