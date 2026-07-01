import { describe, expect, it } from "bun:test";
import { selectManageable } from "./selectManageable";

interface Sys {
  id: string;
  name: string;
}
const items: Sys[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];
const getId = (s: Sys) => s.id;

describe("selectManageable", () => {
  it("offers everything when the caller holds the global rule", () => {
    const result = selectManageable({
      items,
      getId,
      allowAll: true,
      canAccess: () => false,
    });
    expect(result.map(getId)).toEqual(["a", "b", "c"]);
  });

  it("offers only accessible items otherwise", () => {
    const result = selectManageable({
      items,
      getId,
      allowAll: false,
      canAccess: (id) => id === "b",
    });
    expect(result.map(getId)).toEqual(["b"]);
  });

  it("keeps already-selected ids even when not accessible", () => {
    const result = selectManageable({
      items,
      getId,
      allowAll: false,
      canAccess: (id) => id === "b",
      keepIds: ["c"],
    });
    expect(result.map(getId)).toEqual(["b", "c"]);
  });

  it("is fail-closed while loading (canAccess all false, no keeps)", () => {
    const result = selectManageable({
      items,
      getId,
      allowAll: false,
      canAccess: () => false,
    });
    expect(result).toEqual([]);
  });

  it("accepts a Set for keepIds", () => {
    const result = selectManageable({
      items,
      getId,
      allowAll: false,
      canAccess: () => false,
      keepIds: new Set(["a", "c"]),
    });
    expect(result.map(getId)).toEqual(["a", "c"]);
  });
});
