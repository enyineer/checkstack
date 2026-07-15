import { describe, it, expect } from "bun:test";
import {
  getAttributeByPath,
  getLabelByPath,
  getNumberByPath,
} from "./attribute-path";

describe("getAttributeByPath", () => {
  it("prefers a literal flat key over nested traversal", () => {
    expect(
      getAttributeByPath({ attributes: { "a.b": "flat", a: { b: "nested" } }, path: "a.b" }),
    ).toBe("flat");
  });

  it("descends nested objects", () => {
    expect(
      getAttributeByPath({ attributes: { a: { b: { c: 3 } } }, path: "a.b.c" }),
    ).toBe(3);
  });

  it("returns undefined for a missing path or non-object step", () => {
    expect(getAttributeByPath({ attributes: { a: 1 }, path: "a.b" })).toBeUndefined();
    expect(getAttributeByPath({ attributes: undefined, path: "a" })).toBeUndefined();
    expect(getAttributeByPath({ attributes: { a: [1, 2] }, path: "a.0" })).toBeUndefined();
  });

  it("does not traverse the prototype chain", () => {
    expect(getAttributeByPath({ attributes: {}, path: "constructor" })).toBeUndefined();
    expect(getAttributeByPath({ attributes: {}, path: "__proto__.polluted" })).toBeUndefined();
  });
});

describe("getNumberByPath", () => {
  it("accepts numbers and numeric strings, rejects the rest", () => {
    expect(getNumberByPath({ attributes: { n: 4.5 }, path: "n" })).toBe(4.5);
    expect(getNumberByPath({ attributes: { n: "12" }, path: "n" })).toBe(12);
    expect(getNumberByPath({ attributes: { n: "x" }, path: "n" })).toBeUndefined();
    expect(getNumberByPath({ attributes: { n: NaN }, path: "n" })).toBeUndefined();
    expect(getNumberByPath({ attributes: {}, path: "n" })).toBeUndefined();
  });
});

describe("getLabelByPath", () => {
  it("stringifies primitives and omits complex values", () => {
    expect(getLabelByPath({ attributes: { s: "x" }, path: "s" })).toBe("x");
    expect(getLabelByPath({ attributes: { n: 7 }, path: "n" })).toBe("7");
    expect(getLabelByPath({ attributes: { b: true }, path: "b" })).toBe("true");
    expect(getLabelByPath({ attributes: { o: { k: 1 } }, path: "o" })).toBeUndefined();
  });
});
