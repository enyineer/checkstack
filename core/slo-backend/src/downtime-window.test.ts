import { describe, it, expect } from "bun:test";
import {
  eventWindowSeconds,
  aggregateWindowedDowntime,
  type WindowedEventInput,
} from "./downtime-window";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A fixed "now" and a 30-day window ending at now.
const now = new Date("2026-06-04T00:00:00.000Z");
const windowEnd = now;
const windowStart = new Date(now.getTime() - 30 * DAY);

const selfEvent = (
  overrides: Partial<WindowedEventInput> = {},
): WindowedEventInput => ({
  startTime: new Date(now.getTime() - DAY),
  endTime: null,
  attributionType: "self",
  upstreamSystemId: null,
  upstreamSystemName: null,
  ...overrides,
});

describe("eventWindowSeconds", () => {
  it("counts the full window for an OPEN event that started before the window (the bug)", () => {
    // Started 60 days ago, still ongoing. Its in-window portion is the WHOLE
    // 30-day window - it must not be dropped just because it started earlier.
    const seconds = eventWindowSeconds({
      startTime: new Date(now.getTime() - 60 * DAY),
      endTime: null,
      windowStart,
      windowEnd,
      now,
    });
    expect(seconds).toBe((30 * DAY) / 1000);
  });

  it("counts an open event from its start when it started inside the window", () => {
    const seconds = eventWindowSeconds({
      startTime: new Date(now.getTime() - 2 * HOUR),
      endTime: null,
      windowStart,
      windowEnd,
      now,
    });
    expect(seconds).toBe((2 * HOUR) / 1000);
  });

  it("returns 0 for a closed event entirely before the window", () => {
    const seconds = eventWindowSeconds({
      startTime: new Date(now.getTime() - 40 * DAY),
      endTime: new Date(now.getTime() - 35 * DAY),
      windowStart,
      windowEnd,
      now,
    });
    expect(seconds).toBe(0);
  });

  it("clamps an event that started before the window but ended inside it", () => {
    // Started 31 days ago, ended 29 days ago → only 1 day falls in the window.
    const seconds = eventWindowSeconds({
      startTime: new Date(now.getTime() - 31 * DAY),
      endTime: new Date(now.getTime() - 29 * DAY),
      windowStart,
      windowEnd,
      now,
    });
    expect(seconds).toBe(DAY / 1000);
  });

  it("counts the full duration of an event fully inside the window", () => {
    const seconds = eventWindowSeconds({
      startTime: new Date(now.getTime() - 5 * DAY),
      endTime: new Date(now.getTime() - 5 * DAY + 3 * HOUR),
      windowStart,
      windowEnd,
      now,
    });
    expect(seconds).toBe((3 * HOUR) / 1000);
  });
});

describe("aggregateWindowedDowntime", () => {
  it("regression: an open self outage from before the window consumes the whole window", () => {
    // This is the exact dashboard bug: a 'Self/Ongoing' event from ~2 months
    // ago must NOT yield ~0 consumed minutes (which rendered as 100% available
    // while still flagged degraded).
    const result = aggregateWindowedDowntime({
      events: [
        selfEvent({ startTime: new Date(now.getTime() - 60 * DAY) }),
      ],
      windowStart,
      windowEnd,
      now,
    });
    expect(result.selfMinutes).toBe((30 * DAY) / 1000 / 60);
    expect(result.totalMinutes).toBe((30 * DAY) / 1000 / 60);
  });

  it("splits self vs upstream and clamps each to the window", () => {
    const result = aggregateWindowedDowntime({
      events: [
        selfEvent({
          startTime: new Date(now.getTime() - 2 * HOUR),
          endTime: new Date(now.getTime() - 1 * HOUR),
        }),
        {
          startTime: new Date(now.getTime() - 3 * HOUR),
          endTime: new Date(now.getTime() - 2 * HOUR),
          attributionType: "upstream",
          upstreamSystemId: "up-1",
          upstreamSystemName: "Upstream",
        },
      ],
      windowStart,
      windowEnd,
      now,
    });
    expect(result.selfMinutes).toBe(60);
    expect(result.upstreamMinutes).toBe(60);
    expect(result.totalMinutes).toBe(120);
    expect(result.entries).toHaveLength(2);
  });

  it("ignores events fully outside the window", () => {
    const result = aggregateWindowedDowntime({
      events: [
        selfEvent({
          startTime: new Date(now.getTime() - 40 * DAY),
          endTime: new Date(now.getTime() - 35 * DAY),
        }),
      ],
      windowStart,
      windowEnd,
      now,
    });
    expect(result.totalMinutes).toBe(0);
  });
});
