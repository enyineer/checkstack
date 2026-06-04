import { describe, expect, it } from "bun:test";
import { defaultTheme } from "./theme.ts";
import type { TuiLevel, TuiStatus } from "./theme.ts";

const ALL_LEVELS: TuiLevel[] = ["debug", "info", "warn", "error"];
const ALL_STATUSES: TuiStatus[] = [
  "starting",
  "ready",
  "errored",
  "stopped",
];

describe("defaultTheme", () => {
  it("defines a non-empty color for every level", () => {
    for (const level of ALL_LEVELS) {
      expect(defaultTheme.level[level]).toBeString();
      expect(defaultTheme.level[level].length).toBeGreaterThan(0);
    }
  });

  it("defines a non-empty color for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(defaultTheme.status[status]).toBeString();
      expect(defaultTheme.status[status].length).toBeGreaterThan(0);
    }
  });

  it("defines all chrome tokens", () => {
    expect(defaultTheme.chrome.border.length).toBeGreaterThan(0);
    expect(defaultTheme.chrome.dim.length).toBeGreaterThan(0);
    expect(defaultTheme.chrome.accent.length).toBeGreaterThan(0);
    expect(defaultTheme.chrome.text.length).toBeGreaterThan(0);
  });

  it("uses the conventional alert colors (warn yellow, error red)", () => {
    expect(defaultTheme.level.warn).toBe("yellow");
    expect(defaultTheme.level.error).toBe("red");
  });

  it("maps the ready status to green and errored to red", () => {
    expect(defaultTheme.status.ready).toBe("green");
    expect(defaultTheme.status.errored).toBe("red");
  });

  it("does not contain duplicate keys between level and status maps", () => {
    // Sanity: the two maps are independent records with their own key spaces.
    expect(Object.keys(defaultTheme.level).sort()).toEqual(
      [...ALL_LEVELS].sort(),
    );
    expect(Object.keys(defaultTheme.status).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });
});
