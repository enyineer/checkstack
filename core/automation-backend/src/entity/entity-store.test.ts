import { describe, it, expect } from "bun:test";
import { serializeFieldValue } from "./entity-store";

// The drizzle-backed `createEntityStore` is thin glue over the query
// builder (each method maps ~1:1 to a statement); its observable behavior
// is exercised end-to-end through the in-memory `FakeEntityStore` + handle
// tests, and pinned against real Postgres by the Phase-1 integration lane.
// `serializeFieldValue` carries the only standalone logic — the transition
// log's value normalization — so it is tested directly here.
describe("serializeFieldValue", () => {
  it("passes strings through verbatim (no JSON quotes)", () => {
    expect(serializeFieldValue("open")).toBe("open");
  });

  it("renders null / undefined as the literal 'null'", () => {
    expect(serializeFieldValue(null)).toBe("null");
    expect(serializeFieldValue(undefined)).toBe("null");
  });

  it("JSON-encodes non-string scalars and structures", () => {
    expect(serializeFieldValue(42)).toBe("42");
    expect(serializeFieldValue(true)).toBe("true");
    expect(serializeFieldValue(["a", "b"])).toBe('["a","b"]');
    expect(serializeFieldValue({ x: 1 })).toBe('{"x":1}');
  });

  it("is stable for the same string value (powers inStateSince matching)", () => {
    expect(serializeFieldValue("resolved")).toBe(serializeFieldValue("resolved"));
  });
});
