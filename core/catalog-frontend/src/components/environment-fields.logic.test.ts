import { describe, it, expect } from "bun:test";
import {
  metadataToRows,
  rowsToMetadata,
  hasDuplicateKeys,
  emptyRow,
  toggleSelectedId,
  type CustomFieldRow,
} from "./environment-fields.logic";

const row = (key: string, value: string): CustomFieldRow => ({
  rowId: `r-${key}-${value}`,
  key,
  value,
});

describe("metadataToRows", () => {
  it("returns no rows for null/undefined/empty", () => {
    expect(metadataToRows(null)).toEqual([]);
    expect(metadataToRows(undefined)).toEqual([]);
    expect(metadataToRows({})).toEqual([]);
  });

  it("expands string fields verbatim", () => {
    const rows = metadataToRows({ baseUrl: "https://x", region: "eu" });
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["baseUrl", "https://x"],
      ["region", "eu"],
    ]);
  });

  it("stringifies non-string values", () => {
    const rows = metadataToRows({ tier: 1, enabled: true, list: ["a"] });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.tier).toBe("1");
    expect(byKey.enabled).toBe("true");
    expect(byKey.list).toBe('["a"]');
  });

  it("assigns unique row ids", () => {
    const rows = metadataToRows({ a: "1", b: "2" });
    expect(rows[0].rowId).not.toBe(rows[1].rowId);
  });
});

describe("emptyRow", () => {
  it("creates a blank row with a fresh id", () => {
    const r1 = emptyRow();
    const r2 = emptyRow();
    expect(r1.key).toBe("");
    expect(r1.value).toBe("");
    expect(r1.rowId).not.toBe(r2.rowId);
  });
});

describe("rowsToMetadata", () => {
  it("collapses rows into a record", () => {
    expect(rowsToMetadata([row("baseUrl", "https://x"), row("tier", "1")])).toEqual({
      baseUrl: "https://x",
      tier: "1",
    });
  });

  it("drops rows with a blank/whitespace key", () => {
    expect(rowsToMetadata([row("", "ignored"), row("  ", "x"), row("k", "v")])).toEqual({
      k: "v",
    });
  });

  it("trims keys but keeps values verbatim", () => {
    expect(rowsToMetadata([row("  region  ", "  eu  ")])).toEqual({
      region: "  eu  ",
    });
  });

  it("last duplicate key wins", () => {
    expect(rowsToMetadata([row("k", "first"), row("k", "second")])).toEqual({
      k: "second",
    });
  });
});

describe("toggleSelectedId", () => {
  it("adds an id that is not selected", () => {
    expect(toggleSelectedId({ selected: ["a"], id: "b" })).toEqual(["a", "b"]);
  });

  it("removes an id that is already selected", () => {
    expect(toggleSelectedId({ selected: ["a", "b"], id: "a" })).toEqual(["b"]);
  });

  it("does not mutate the input array", () => {
    const selected = ["a"];
    toggleSelectedId({ selected, id: "b" });
    expect(selected).toEqual(["a"]);
  });
});

describe("hasDuplicateKeys", () => {
  it("is false when keys are unique", () => {
    expect(hasDuplicateKeys([row("a", "1"), row("b", "2")])).toBe(false);
  });

  it("ignores blank keys", () => {
    expect(hasDuplicateKeys([row("", "1"), row("", "2"), row("a", "3")])).toBe(false);
  });

  it("detects duplicate non-blank keys (after trim)", () => {
    expect(hasDuplicateKeys([row("a ", "1"), row(" a", "2")])).toBe(true);
  });
});
