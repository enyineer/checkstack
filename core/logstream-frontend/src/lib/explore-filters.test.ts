import { describe, expect, it } from "bun:test";
import type { LogEvent } from "@checkstack/logstream-common";
import {
  cursorFromEvent,
  defaultExploreRange,
  effectiveExploreRange,
  EMPTY_EXPLORE_FILTERS,
  hasActiveFilters,
  mergeOlderEvents,
  toggleBand,
  toSearchInput,
  type ExploreFilters,
} from "./explore-filters";

function event(id: string, tsMs: number): LogEvent {
  return {
    id,
    streamId: "s1",
    ts: new Date(tsMs),
    observedAt: new Date(tsMs),
    severityNumber: 9,
    severityText: null,
    band: "info",
    body: `line ${id}`,
    attributes: null,
    resource: null,
    patternId: null,
    traceId: null,
    spanId: null,
  };
}

describe("toggleBand", () => {
  it("adds a band and keeps canonical order", () => {
    expect(toggleBand(["error"], "debug")).toEqual(["debug", "error"]);
    expect(toggleBand(["warn"], "fatal")).toEqual(["warn", "fatal"]);
  });

  it("removes an already-selected band", () => {
    expect(toggleBand(["warn", "error"], "warn")).toEqual(["error"]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty filter set", () => {
    expect(hasActiveFilters(EMPTY_EXPLORE_FILTERS)).toBe(false);
  });

  it("is true when any facet is set", () => {
    expect(hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, text: "boom" })).toBe(true);
    expect(
      hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, severityBands: ["error"] }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, patternId: "p1" }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, traceId: "abc123" }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, from: new Date() }),
    ).toBe(true);
  });

  it("ignores whitespace-only text", () => {
    expect(hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, text: "   " })).toBe(
      false,
    );
  });

  it("ignores whitespace-only traceId", () => {
    expect(hasActiveFilters({ ...EMPTY_EXPLORE_FILTERS, traceId: "   " })).toBe(
      false,
    );
  });
});

describe("toSearchInput", () => {
  it("omits empty facets and trims text", () => {
    const input = toSearchInput({
      streamId: "s1",
      filters: { ...EMPTY_EXPLORE_FILTERS, text: "  oops  " },
    });
    expect(input).toEqual({ streamId: "s1", text: "oops", limit: 100 });
    expect("severityBands" in input).toBe(false);
    expect("patternId" in input).toBe(false);
    expect("cursor" in input).toBe(false);
  });

  it("forwards set facets, cursor and limit", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-02T00:00:00Z");
    const cursor = { ts: new Date("2026-01-01T12:00:00Z"), id: "42" };
    const filters: ExploreFilters = {
      text: "",
      severityBands: ["error", "fatal"],
      patternId: "pat-1",
      traceId: "  trace-42  ",
      from,
      to,
    };
    const input = toSearchInput({ streamId: "s1", filters, cursor, limit: 50 });
    expect(input).toEqual({
      streamId: "s1",
      severityBands: ["error", "fatal"],
      patternId: "pat-1",
      traceId: "trace-42",
      from,
      to,
      cursor,
      limit: 50,
    });
    expect("text" in input).toBe(false);
  });

  it("omits a blank traceId", () => {
    const input = toSearchInput({
      streamId: "s1",
      filters: { ...EMPTY_EXPLORE_FILTERS, traceId: "   " },
    });
    expect("traceId" in input).toBe(false);
  });
});

describe("cursorFromEvent", () => {
  it("takes ts + id from the event", () => {
    const e = event("7", 1_000);
    expect(cursorFromEvent(e)).toEqual({ ts: e.ts, id: "7" });
  });
});

describe("mergeOlderEvents", () => {
  it("appends the older page after the current list", () => {
    const current = [event("3", 300), event("2", 200)];
    const incoming = [event("1", 100)];
    const merged = mergeOlderEvents({ current, incoming });
    expect(merged.map((e) => e.id)).toEqual(["3", "2", "1"]);
  });

  it("de-duplicates overlapping ids from a live refresh", () => {
    const current = [event("3", 300), event("2", 200)];
    const incoming = [event("2", 200), event("1", 100)];
    const merged = mergeOlderEvents({ current, incoming });
    expect(merged.map((e) => e.id)).toEqual(["3", "2", "1"]);
  });

  it("returns the current list unchanged when the older page is empty", () => {
    const current = [event("3", 300)];
    expect(mergeOlderEvents({ current, incoming: [] })).toEqual(current);
  });
});

describe("defaultExploreRange", () => {
  it("quantizes the end up to the next minute boundary", () => {
    // 12:34:17.500 -> 12:35:00.000
    const now = Date.UTC(2026, 0, 1, 12, 34, 17, 500);
    const { endDate } = defaultExploreRange({ now });
    expect(endDate.getTime()).toBe(Date.UTC(2026, 0, 1, 12, 35, 0, 0));
  });

  it("keeps an exact minute boundary as-is", () => {
    const now = Date.UTC(2026, 0, 1, 12, 35, 0, 0);
    const { endDate } = defaultExploreRange({ now });
    expect(endDate.getTime()).toBe(now);
  });

  it("spans exactly 24 hours", () => {
    const { startDate, endDate } = defaultExploreRange({
      now: Date.UTC(2026, 0, 1, 12, 34, 17),
    });
    expect(endDate.getTime() - startDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("is value-stable across calls within the same minute (stable query key)", () => {
    const a = defaultExploreRange({ now: Date.UTC(2026, 0, 1, 12, 34, 1) });
    const b = defaultExploreRange({ now: Date.UTC(2026, 0, 1, 12, 34, 59, 999) });
    expect(a.startDate.getTime()).toBe(b.startDate.getTime());
    expect(a.endDate.getTime()).toBe(b.endDate.getTime());
  });

  it("rolls forward once the minute passes", () => {
    const a = defaultExploreRange({ now: Date.UTC(2026, 0, 1, 12, 34, 59) });
    const b = defaultExploreRange({ now: Date.UTC(2026, 0, 1, 12, 35, 1) });
    expect(b.endDate.getTime()).toBe(a.endDate.getTime() + 60_000);
  });
});

describe("effectiveExploreRange", () => {
  const now = Date.UTC(2026, 0, 1, 12, 34, 17);

  it("uses the explicit pick when both bounds are set", () => {
    const from = new Date(Date.UTC(2025, 11, 30));
    const to = new Date(Date.UTC(2025, 11, 31));
    expect(effectiveExploreRange({ from, to, now })).toEqual({
      startDate: from,
      endDate: to,
    });
  });

  it("falls back to the quantized default window when no pick is set", () => {
    const range = effectiveExploreRange({ from: null, to: null, now });
    expect(range).toEqual(defaultExploreRange({ now }));
    // The events search is bounded by this window, so a pattern filter can
    // never fetch its full unbounded history.
    expect(range.endDate.getTime() - range.startDate.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it("falls back when only one bound is set", () => {
    const from = new Date(Date.UTC(2025, 11, 30));
    expect(effectiveExploreRange({ from, to: null, now })).toEqual(
      defaultExploreRange({ now }),
    );
  });
});
