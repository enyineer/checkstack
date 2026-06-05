import { describe, expect, test } from "bun:test";
import { computeFieldDiff } from "./field-diff";

describe("computeFieldDiff", () => {
  test("no change yields an empty diff", () => {
    expect(
      computeFieldDiff({ before: { a: 1, b: "x" }, after: { a: 1, b: "x" } }),
    ).toEqual([]);
  });

  test("reports a changed scalar with a dotted path", () => {
    const diff = computeFieldDiff({
      before: { intervalSeconds: 60 },
      after: { intervalSeconds: 30 },
    });
    expect(diff).toEqual([{ path: "intervalSeconds", before: 60, after: 30 }]);
  });

  test("recurses into nested objects with dotted paths", () => {
    const diff = computeFieldDiff({
      before: { config: { url: "https://a", method: "GET" } },
      after: { config: { url: "https://b", method: "GET" } },
    });
    expect(diff).toEqual([
      { path: "config.url", before: "https://a", after: "https://b" },
    ]);
  });

  test("recurses into arrays element-wise (added element)", () => {
    const diff = computeFieldDiff({
      before: { collectors: [{ id: "a" }] },
      after: { collectors: [{ id: "a" }, { id: "b" }] },
    });
    // The unchanged element [0] produces no row; only the added [1] surfaces.
    expect(diff).toEqual([
      { path: "collectors[1]", before: undefined, after: { id: "b" } },
    ]);
  });

  test("surfaces a single changed field deep inside an array element", () => {
    const diff = computeFieldDiff({
      before: { collectors: [{ id: "a", config: { script: "old" } }] },
      after: { collectors: [{ id: "a", config: { script: "new" } }] },
    });
    expect(diff).toEqual([
      {
        path: "collectors[0].config.script",
        before: "old",
        after: "new",
      },
    ]);
  });

  test("an element removed from the array surfaces against undefined", () => {
    const diff = computeFieldDiff({
      before: { tags: ["a", "b"] },
      after: { tags: ["a"] },
    });
    expect(diff).toEqual([
      { path: "tags[1]", before: "b", after: undefined },
    ]);
  });

  test("a value that changes shape (array <-> scalar) is one diff", () => {
    const diff = computeFieldDiff({
      before: { x: [1, 2] },
      after: { x: "now a string" },
    });
    expect(diff).toEqual([
      { path: "x", before: [1, 2], after: "now a string" },
    ]);
  });

  test("captures added and removed fields", () => {
    const diff = computeFieldDiff({
      before: { a: 1 },
      after: { b: 2 },
    });
    expect(diff).toEqual([
      { path: "a", before: 1, after: undefined },
      { path: "b", before: undefined, after: 2 },
    ]);
  });

  test("is order-insensitive for object keys", () => {
    expect(
      computeFieldDiff({ before: { a: 1, b: 2 }, after: { b: 2, a: 1 } }),
    ).toEqual([]);
  });
});
