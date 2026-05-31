import { describe, it, expect } from "bun:test";
import { stableStringify, structurallyEqual } from "./stable-stringify";

describe("stableStringify", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(
      stableStringify({ b: 2, a: 1 }),
    );
  });

  it("treats undefined as absent (matches JSON semantics)", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(
      stableStringify({ a: 1 }),
    );
  });

  it("serializes nested objects deterministically", () => {
    const a = { outer: { z: 1, a: 2 }, list: [3, { y: 1, x: 2 }] };
    const b = { list: [3, { x: 2, y: 1 }], outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("distinguishes different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("distinguishes array order (arrays are ordered)", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("normalizes non-finite numbers to null", () => {
    expect(stableStringify({ a: Number.NaN })).toBe(stableStringify({ a: null }));
    expect(stableStringify({ a: Infinity })).toBe(stableStringify({ a: null }));
  });

  it("treats an explicit-null field as distinct from an absent field", () => {
    // `{a: null}` is `{"a":null}`; `{a: undefined}` drops the key entirely,
    // so they are NOT structurally equal — a field explicitly set to null
    // is a real value, whereas undefined means absent.
    expect(structurallyEqual({ a: null }, { a: undefined })).toBe(false);
    expect(structurallyEqual({ a: undefined }, {})).toBe(true);
  });
});

describe("structurallyEqual", () => {
  it("returns true for structurally equal objects with different key order", () => {
    expect(structurallyEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(
      true,
    );
  });

  it("returns false on a real difference", () => {
    expect(structurallyEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
