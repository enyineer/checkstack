import { describe, it, expect } from "bun:test";
import {
  modeFromEnvironmentIds,
  environmentIdsForMode,
  toggleEnvironmentId,
  environmentSectionView,
} from "./environment-selector.logic";

describe("modeFromEnvironmentIds", () => {
  it("null => all", () => {
    expect(modeFromEnvironmentIds(null)).toBe("all");
  });
  it("undefined => all", () => {
    expect(modeFromEnvironmentIds(undefined)).toBe("all");
  });
  it("[] => none", () => {
    expect(modeFromEnvironmentIds([])).toBe("none");
  });
  it("non-empty => specific", () => {
    expect(modeFromEnvironmentIds(["prod"])).toBe("specific");
  });
});

describe("environmentIdsForMode", () => {
  it("all => null", () => {
    expect(environmentIdsForMode({ mode: "all", selectedIds: ["x"] })).toBeNull();
  });
  it("none => []", () => {
    expect(environmentIdsForMode({ mode: "none", selectedIds: ["x"] })).toEqual(
      [],
    );
  });
  it("specific => the selected ids verbatim", () => {
    expect(
      environmentIdsForMode({ mode: "specific", selectedIds: ["prod", "qa"] }),
    ).toEqual(["prod", "qa"]);
  });

  it("round-trips through modeFromEnvironmentIds for all three modes", () => {
    expect(
      modeFromEnvironmentIds(
        environmentIdsForMode({ mode: "all", selectedIds: [] }),
      ),
    ).toBe("all");
    expect(
      modeFromEnvironmentIds(
        environmentIdsForMode({ mode: "none", selectedIds: [] }),
      ),
    ).toBe("none");
    expect(
      modeFromEnvironmentIds(
        environmentIdsForMode({ mode: "specific", selectedIds: ["e1"] }),
      ),
    ).toBe("specific");
  });
});

describe("environmentSectionView", () => {
  it("settled with no environments => empty, regardless of environmentIds", () => {
    expect(
      environmentSectionView({
        environments: [],
        environmentIds: null,
        settled: true,
      }),
    ).toEqual({ kind: "empty" });
    expect(
      environmentSectionView({
        environments: [],
        environmentIds: [],
        settled: true,
      }),
    ).toEqual({ kind: "empty" });
    expect(
      environmentSectionView({
        environments: [],
        environmentIds: ["x"],
        settled: true,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("NOT settled with no environments => selector (loading/error must not collapse to empty)", () => {
    // Query still loading or errored: keep the mode selector (driven by the
    // stored environmentIds) rather than falsely showing "No environment
    // configured" and hiding the control.
    expect(
      environmentSectionView({
        environments: [],
        environmentIds: null,
        settled: false,
      }),
    ).toEqual({ kind: "selector", mode: "all" });
    expect(
      environmentSectionView({
        environments: [],
        environmentIds: ["e1"],
        settled: false,
      }),
    ).toEqual({ kind: "selector", mode: "specific" });
  });

  it("has environments, environmentIds=null => selector in 'all' mode", () => {
    expect(
      environmentSectionView({
        environments: [{ id: "e1" }],
        environmentIds: null,
        settled: true,
      }),
    ).toEqual({ kind: "selector", mode: "all" });
  });

  it("has environments, environmentIds=[] => selector in 'none' mode", () => {
    expect(
      environmentSectionView({
        environments: [{ id: "e1" }],
        environmentIds: [],
        settled: true,
      }),
    ).toEqual({ kind: "selector", mode: "none" });
  });

  it("has environments, non-empty environmentIds => selector in 'specific' mode", () => {
    expect(
      environmentSectionView({
        environments: [{ id: "e1" }],
        environmentIds: ["e1"],
        settled: true,
      }),
    ).toEqual({ kind: "selector", mode: "specific" });
  });

  it("has environments while not yet settled => still shows the selector", () => {
    expect(
      environmentSectionView({
        environments: [{ id: "e1" }],
        environmentIds: null,
        settled: false,
      }),
    ).toEqual({ kind: "selector", mode: "all" });
  });
});

describe("toggleEnvironmentId", () => {
  it("adds an id not present, preserving order", () => {
    expect(
      toggleEnvironmentId({ selectedIds: ["a"], environmentId: "b" }),
    ).toEqual(["a", "b"]);
  });
  it("removes an id already present", () => {
    expect(
      toggleEnvironmentId({ selectedIds: ["a", "b"], environmentId: "a" }),
    ).toEqual(["b"]);
  });
});
