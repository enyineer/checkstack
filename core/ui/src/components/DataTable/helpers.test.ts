import { describe, expect, it } from "bun:test";
import {
  compareSortValues,
  filterRows,
  rowMatchesSearch,
  toSortValue,
} from "./helpers";

describe("toSortValue", () => {
  it("passes through strings and numbers", () => {
    expect(toSortValue("a")).toBe("a");
    expect(toSortValue(42)).toBe(42);
    expect(toSortValue(0)).toBe(0);
  });

  it("maps nullish to undefined", () => {
    expect(toSortValue(null)).toBeUndefined();
    expect(toSortValue(undefined)).toBeUndefined();
  });

  it("stringifies other values so ordering stays stable", () => {
    expect(toSortValue(true)).toBe("true");
    expect(toSortValue(new Date("2020-01-01T00:00:00.000Z"))).toContain("2020");
  });
});

describe("compareSortValues", () => {
  it("compares numbers numerically, not lexically", () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
    expect(compareSortValues(10, 2)).toBeGreaterThan(0);
    expect(compareSortValues(5, 5)).toBe(0);
  });

  it("compares strings case-insensitively", () => {
    expect(compareSortValues("apple", "Banana")).toBeLessThan(0);
    expect(compareSortValues("Banana", "apple")).toBeGreaterThan(0);
  });

  it("orders numeric substrings naturally", () => {
    expect(compareSortValues("item 2", "item 10")).toBeLessThan(0);
  });

  it("always sorts nullish last", () => {
    expect(compareSortValues(null, "a")).toBeGreaterThan(0);
    expect(compareSortValues("a", null)).toBeLessThan(0);
    expect(compareSortValues(undefined, 5)).toBeGreaterThan(0);
    expect(compareSortValues(null, undefined)).toBe(0);
  });

  it("sorts an array ascending as expected", () => {
    const sorted = [3, 1, 20, null, 2].sort(compareSortValues);
    expect(sorted).toEqual([1, 2, 3, 20, null]);
  });
});

interface Row {
  name: string;
  team: string;
}

const rows: Row[] = [
  { name: "Alpha service", team: "Platform" },
  { name: "Beta worker", team: "Payments" },
  { name: "Gamma cron", team: "Platform" },
];

const searchAccessors = [(r: Row) => r.name, (r: Row) => r.team];

describe("rowMatchesSearch", () => {
  it("matches everything for an empty query", () => {
    expect(
      rowMatchesSearch({ row: rows[0]!, searchAccessors, query: "  " }),
    ).toBe(true);
  });

  it("matches case-insensitively across any searchable column", () => {
    expect(
      rowMatchesSearch({ row: rows[1]!, searchAccessors, query: "payment" }),
    ).toBe(true);
    expect(
      rowMatchesSearch({ row: rows[1]!, searchAccessors, query: "BETA" }),
    ).toBe(true);
  });

  it("does not match when no column contains the query", () => {
    expect(
      rowMatchesSearch({ row: rows[0]!, searchAccessors, query: "payments" }),
    ).toBe(false);
  });
});

describe("filterRows", () => {
  it("returns the same reference when there is nothing to filter", () => {
    expect(filterRows({ rows, searchAccessors, query: "" })).toBe(rows);
    expect(filterRows({ rows, searchAccessors: [], query: "x" })).toBe(rows);
  });

  it("filters to matching rows across columns", () => {
    expect(
      filterRows({ rows, searchAccessors, query: "platform" }).map(
        (r) => r.name,
      ),
    ).toEqual(["Alpha service", "Gamma cron"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRows({ rows, searchAccessors, query: "zzz" })).toEqual([]);
  });
});
