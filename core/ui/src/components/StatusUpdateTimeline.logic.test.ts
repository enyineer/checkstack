import { describe, expect, it } from "bun:test";
import { resolveEffectiveStatuses } from "./StatusUpdateTimeline.logic";

/**
 * The rail dot's colour. Input is NEWEST FIRST, matching what the status-page
 * widgets publish.
 */

describe("resolveEffectiveStatuses", () => {
  it("keeps each update's own status change", () => {
    expect(
      resolveEffectiveStatuses(["monitoring", "identified", "investigating"])
    ).toEqual(["monitoring", "identified", "investigating"]);
  });

  it("inherits the last status set BEFORE a changeless update", () => {
    // Newest first: the changeless entry sits between "monitoring" (newer) and
    // "identified" (older). The status in effect when it was posted is the
    // OLDER one - "identified" - because "monitoring" had not happened yet.
    expect(
      resolveEffectiveStatuses(["monitoring", undefined, "identified"])
    ).toEqual(["monitoring", "identified", "identified"]);
  });

  it("carries one status across a run of changeless updates", () => {
    expect(
      resolveEffectiveStatuses([undefined, undefined, "investigating"])
    ).toEqual(["investigating", "investigating", "investigating"]);
  });

  it("leaves entries older than every known change unresolved", () => {
    // The widget caps its update count, so the window can start part-way
    // through a history: the tail genuinely has no known status, and the
    // caller falls back to the event's own tone rather than guessing.
    expect(
      resolveEffectiveStatuses(["monitoring", undefined, undefined])
    ).toEqual(["monitoring", undefined, undefined]);
  });

  it("never back-fills a NEWER status onto an older update", () => {
    // The bug this guards: taking the event's current status for every
    // changeless entry would claim the incident was already "resolved" while
    // it was still being investigated.
    expect(resolveEffectiveStatuses(["resolved", undefined])).toEqual([
      "resolved",
      undefined,
    ]);
  });

  it("returns all-unresolved when no update changed status", () => {
    expect(resolveEffectiveStatuses([undefined, undefined])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("handles an empty history", () => {
    expect(resolveEffectiveStatuses([])).toEqual([]);
  });
});
