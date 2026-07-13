import { describe, it, expect } from "bun:test";
import { canonicalLabelString, computeSeriesId } from "./series-id";

describe("canonicalLabelString", () => {
  it("sorts keys so label order does not change the string", () => {
    const a = canonicalLabelString({ b: "2", a: "1" });
    const b = canonicalLabelString({ a: "1", b: "2" });
    expect(a).toBe(b);
    expect(a).toBe('{a="1",b="2"}');
  });

  it("canonicalizes an empty label set to `{}`", () => {
    expect(canonicalLabelString({})).toBe("{}");
  });

  it("escapes values so a value containing a comma is unambiguous", () => {
    expect(canonicalLabelString({ k: 'a,b"c' })).toBe('{k="a,b\\"c"}');
  });
});

describe("computeSeriesId", () => {
  it("is stable across label insertion order", () => {
    const id1 = computeSeriesId({
      streamId: "s",
      name: "m",
      labels: { x: "1", y: "2" },
    });
    const id2 = computeSeriesId({
      streamId: "s",
      name: "m",
      labels: { y: "2", x: "1" },
    });
    expect(id1).toBe(id2);
  });

  it("differs for a different stream, name, or labels", () => {
    const base = computeSeriesId({ streamId: "s", name: "m", labels: {} });
    expect(base).not.toBe(
      computeSeriesId({ streamId: "s2", name: "m", labels: {} }),
    );
    expect(base).not.toBe(
      computeSeriesId({ streamId: "s", name: "m2", labels: {} }),
    );
    expect(base).not.toBe(
      computeSeriesId({ streamId: "s", name: "m", labels: { a: "1" } }),
    );
  });

  it("returns a 64-char sha256 hex digest", () => {
    const id = computeSeriesId({ streamId: "s", name: "m", labels: {} });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
