import { describe, it, expect } from "bun:test";
import { slotContextEquals } from "./components/ExtensionSlot";

/**
 * Regression guard for the per-row slot re-render storm: `ExtensionSlot`
 * renders every extension through a memoized component whose bail-out is
 * `slotContextEquals` - value-level equality over the (inline-constructed)
 * context object. If this comparator regresses to identity comparison, every
 * parent render re-runs every filler's hook tree again (on the catalog
 * manager: rows x fillers x auth/query hooks - the GC-dominated main-thread
 * storm this fixed). Sibling of `orpc-client-cache.test.ts`, which guards the
 * previous storm of the same shape.
 */
describe("slotContextEquals", () => {
  it("treats a fresh object with identical values as equal (the inline-context case)", () => {
    const visibleSystemIds = ["sys-1", "sys-2"]; // memoized at the call site
    const a = { systemId: "sys-1", systemName: "Payments", visibleSystemIds };
    const b = { systemId: "sys-1", systemName: "Payments", visibleSystemIds };
    expect(slotContextEquals(a, b)).toBe(true);
  });

  it("detects a changed value", () => {
    expect(
      slotContextEquals({ systemId: "sys-1" }, { systemId: "sys-2" }),
    ).toBe(false);
  });

  it("compares arrays/objects by IDENTITY (call sites must memoize them)", () => {
    // A rebuilt array defeats the bail-out by design - the comparator cannot
    // know the call site's semantics. Keeping this shallow (not deep) is what
    // makes the memo safe and cheap.
    expect(
      slotContextEquals(
        { visibleSystemIds: ["sys-1"] },
        { visibleSystemIds: ["sys-1"] },
      ),
    ).toBe(false);
  });

  it("detects added/removed/renamed keys", () => {
    expect(slotContextEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(slotContextEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(slotContextEquals({ a: undefined }, { b: undefined })).toBe(false);
  });

  it("handles undefined contexts (context-less slots)", () => {
    expect(slotContextEquals(undefined, undefined)).toBe(true);
    expect(slotContextEquals({ a: 1 }, undefined)).toBe(false);
    expect(slotContextEquals(undefined, { a: 1 })).toBe(false);
  });

  it("treats NaN as equal to itself and distinguishes +0/-0 (Object.is semantics)", () => {
    expect(slotContextEquals({ v: Number.NaN }, { v: Number.NaN })).toBe(true);
    expect(slotContextEquals({ v: 0 }, { v: -0 })).toBe(false);
  });
});
