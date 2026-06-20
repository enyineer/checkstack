import { describe, expect, test } from "bun:test";
import {
  autoLayout,
  combineStatus,
  getBadgeLabel,
  getBadgeTone,
  type SavedNodePosition,
} from "./dependencyDisplay.logic";

describe("combineStatus", () => {
  test("defaults to operational when nothing is provided", () => {
    expect(combineStatus({})).toBe("operational");
  });

  test("info ranks as operational (non-degrading signal)", () => {
    expect(combineStatus({ status: "info", derivedState: "info" })).toBe(
      "operational",
    );
  });

  test("takes the worse of own status and derived state", () => {
    expect(
      combineStatus({ status: "operational", derivedState: "degraded" }),
    ).toBe("degraded");
    expect(combineStatus({ status: "down", derivedState: "info" })).toBe("down");
  });

  test("down dominates degraded regardless of which side it is on", () => {
    expect(combineStatus({ status: "degraded", derivedState: "down" })).toBe(
      "down",
    );
    expect(combineStatus({ status: "down", derivedState: "degraded" })).toBe(
      "down",
    );
  });

  test("unknown status strings are treated as operational", () => {
    expect(combineStatus({ status: "bogus", derivedState: "bogus" })).toBe(
      "operational",
    );
  });
});

describe("getBadgeTone", () => {
  test("maps each derived state to a tone", () => {
    expect(getBadgeTone({ state: "down" })).toBe("error");
    expect(getBadgeTone({ state: "degraded" })).toBe("warn");
    expect(getBadgeTone({ state: "info" })).toBe("info");
  });
});

describe("getBadgeLabel", () => {
  test("maps each derived state to a label", () => {
    expect(getBadgeLabel({ state: "down" })).toBe("Upstream down");
    expect(getBadgeLabel({ state: "degraded" })).toBe("Upstream degraded");
    expect(getBadgeLabel({ state: "info" })).toBe("Dependency info");
  });
});

describe("autoLayout", () => {
  test("honors saved positions verbatim", () => {
    const saved: SavedNodePosition[] = [{ systemId: "a", x: 12, y: 34 }];
    const map = autoLayout({ systemIds: ["a"], savedPositions: saved });
    expect(map.get("a")).toEqual({ x: 12, y: 34 });
  });

  test("auto-places unpositioned nodes in a square-ish grid", () => {
    // 4 nodes -> cols = ceil(sqrt(4)) = 2, spacing 250x120, offset 100,100.
    const map = autoLayout({
      systemIds: ["a", "b", "c", "d"],
      savedPositions: [],
    });
    expect(map.get("a")).toEqual({ x: 100, y: 100 });
    expect(map.get("b")).toEqual({ x: 350, y: 100 });
    expect(map.get("c")).toEqual({ x: 100, y: 220 });
    expect(map.get("d")).toEqual({ x: 350, y: 220 });
  });

  test("a saved node is excluded from the grid index sequence", () => {
    // "a" is saved, so only b,c are unpositioned -> cols = ceil(sqrt(2)) = 2.
    const map = autoLayout({
      systemIds: ["a", "b", "c"],
      savedPositions: [{ systemId: "a", x: 5, y: 5 }],
    });
    expect(map.get("a")).toEqual({ x: 5, y: 5 });
    expect(map.get("b")).toEqual({ x: 100, y: 100 });
    expect(map.get("c")).toEqual({ x: 350, y: 100 });
  });

  test("includes saved positions even when absent from systemIds", () => {
    const map = autoLayout({
      systemIds: [],
      savedPositions: [{ systemId: "ghost", x: 1, y: 2 }],
    });
    expect(map.get("ghost")).toEqual({ x: 1, y: 2 });
  });

  test("empty input yields an empty map", () => {
    expect(autoLayout({ systemIds: [], savedPositions: [] }).size).toBe(0);
  });
});
