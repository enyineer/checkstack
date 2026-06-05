import { describe, it, expect } from "bun:test";
import {
  modeFromEnvironmentIds,
  environmentIdsForMode,
  toggleEnvironmentId,
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
