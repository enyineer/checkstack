import { describe, expect, test } from "bun:test";
import {
  autoLayout,
  centerLayout,
  combineStatus,
  getBadgeLabel,
  getBadgeTone,
  type SavedNodePosition,
  sugiyamaLayout,
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

describe("sugiyamaLayout", () => {
  test("places upstream targets to the right of their dependents", () => {
    // a -> b -> c : c is the deepest upstream, so columns increase left→right.
    const map = sugiyamaLayout({
      systemIds: ["a", "b", "c"],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    });
    const a = map.get("a");
    const b = map.get("b");
    const c = map.get("c");
    expect(a && b && c).toBeTruthy();
    expect(a?.x).toBeLessThan(b?.x ?? 0);
    expect(b?.x).toBeLessThan(c?.x ?? 0);
  });

  test("uses the longest path so a shortcut edge still stacks layers", () => {
    // a depends on b and c; b depends on c. c must be right of b, b right of a.
    const map = sugiyamaLayout({
      systemIds: ["a", "b", "c"],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "c" },
      ],
    });
    expect((map.get("a")?.x ?? 0) < (map.get("b")?.x ?? 0)).toBe(true);
    expect((map.get("b")?.x ?? 0) < (map.get("c")?.x ?? 0)).toBe(true);
  });

  test("parks edgeless nodes to the right of the wired graph", () => {
    const map = sugiyamaLayout({
      systemIds: ["a", "b", "lonely"],
      edges: [{ source: "a", target: "b" }],
    });
    const wiredMaxX = Math.max(map.get("a")?.x ?? 0, map.get("b")?.x ?? 0);
    expect(map.get("lonely")?.x ?? 0).toBeGreaterThan(wiredMaxX);
  });

  test("orders a column to reduce crossings (child sits under its parent)", () => {
    // Layer 1: [test2, aw]. Layer 2: test3+jelly hang off test2, mono off aw.
    // Input lists mono before jelly, but jelly must end up ABOVE mono because
    // its parent (test2) is above aw. This is the reported Jellyfin case.
    const map = sugiyamaLayout({
      systemIds: ["test", "test2", "aw", "test3", "mono", "jelly"],
      edges: [
        { source: "test", target: "test2" },
        { source: "test", target: "aw" },
        { source: "test2", target: "test3" },
        { source: "test2", target: "jelly" },
        { source: "aw", target: "mono" },
      ],
    });
    expect(map.get("jelly")?.y ?? 0).toBeLessThan(map.get("mono")?.y ?? 0);
  });

  test("respects a custom origin", () => {
    const map = sugiyamaLayout({
      systemIds: ["only"],
      edges: [],
      origin: { x: 500, y: 300 },
    });
    expect(map.get("only")).toEqual({ x: 500, y: 300 });
  });
});

describe("centerLayout", () => {
  test("puts upstream to the right and downstream to the left of the focus", () => {
    // down -> focus -> up : focus depends on up, down depends on focus.
    const map = centerLayout({
      focusId: "focus",
      systemIds: ["down", "focus", "up"],
      edges: [
        { source: "down", target: "focus" },
        { source: "focus", target: "up" },
      ],
    });
    expect(map.get("down")?.x ?? 0).toBeLessThan(map.get("focus")?.x ?? 0);
    expect(map.get("focus")?.x ?? 0).toBeLessThan(map.get("up")?.x ?? 0);
  });

  test("parks nodes unreachable from the focus below the band", () => {
    const map = centerLayout({
      focusId: "focus",
      systemIds: ["focus", "up", "other"],
      edges: [{ source: "focus", target: "up" }],
    });
    const bandMaxY = Math.max(map.get("focus")?.y ?? 0, map.get("up")?.y ?? 0);
    expect(map.get("other")?.y ?? 0).toBeGreaterThan(bandMaxY);
  });

  test("falls back to sugiyama when the focus is absent", () => {
    const map = centerLayout({
      focusId: "missing",
      systemIds: ["a", "b"],
      edges: [{ source: "a", target: "b" }],
    });
    expect((map.get("a")?.x ?? 0) < (map.get("b")?.x ?? 0)).toBe(true);
  });
});

describe("autoLayout", () => {
  test("honors saved positions verbatim", () => {
    const saved: SavedNodePosition[] = [{ systemId: "a", x: 12, y: 34 }];
    const map = autoLayout({ systemIds: ["a"], savedPositions: saved, edges: [] });
    expect(map.get("a")).toEqual({ x: 12, y: 34 });
  });

  test("lays out the whole graph when nothing is saved", () => {
    const map = autoLayout({
      systemIds: ["a", "b"],
      savedPositions: [],
      edges: [{ source: "a", target: "b" }],
    });
    expect((map.get("a")?.x ?? 0) < (map.get("b")?.x ?? 0)).toBe(true);
  });

  test("never moves a saved node and drops new nodes below the saved box", () => {
    const map = autoLayout({
      systemIds: ["a", "b", "c"],
      savedPositions: [{ systemId: "a", x: 5, y: 5 }],
      edges: [{ source: "b", target: "c" }],
    });
    expect(map.get("a")).toEqual({ x: 5, y: 5 });
    // New nodes are arranged below the saved bounding box (y = 5).
    expect(map.get("b")?.y ?? 0).toBeGreaterThan(5);
    expect(map.get("c")?.y ?? 0).toBeGreaterThan(5);
    // ...and still layered by dependency (c is upstream of b).
    expect((map.get("b")?.x ?? 0) < (map.get("c")?.x ?? 0)).toBe(true);
  });

  test("includes saved positions even when absent from systemIds", () => {
    const map = autoLayout({
      systemIds: [],
      savedPositions: [{ systemId: "ghost", x: 1, y: 2 }],
      edges: [],
    });
    expect(map.get("ghost")).toEqual({ x: 1, y: 2 });
  });

  test("empty input yields an empty map", () => {
    expect(
      autoLayout({ systemIds: [], savedPositions: [], edges: [] }).size,
    ).toBe(0);
  });
});
