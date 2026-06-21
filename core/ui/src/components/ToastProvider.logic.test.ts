import { describe, expect, it } from "bun:test";
import { MAX_VISIBLE_TOASTS, selectVisibleToasts } from "./ToastProvider";

describe("ToastProvider - selectVisibleToasts", () => {
  it("returns all toasts and zero overflow when under the cap", () => {
    const { visible, overflowCount } = selectVisibleToasts({
      toasts: ["a", "b"],
    });
    expect(visible).toEqual(["a", "b"]);
    expect(overflowCount).toBe(0);
  });

  it("returns exactly the cap with zero overflow at the boundary", () => {
    const toasts = Array.from({ length: MAX_VISIBLE_TOASTS }, (_, i) => `t${i}`);
    const { visible, overflowCount } = selectVisibleToasts({ toasts });
    expect(visible).toEqual(toasts);
    expect(overflowCount).toBe(0);
  });

  it("keeps the most-recent cap items in oldest-first order and counts overflow", () => {
    const { visible, overflowCount } = selectVisibleToasts({
      toasts: ["a", "b", "c", "d", "e"],
      cap: 3,
    });
    // Newest are c, d, e (pushed last); rendered oldest-first within the window.
    expect(visible).toEqual(["c", "d", "e"]);
    expect(overflowCount).toBe(2);
  });

  it("handles an empty queue", () => {
    const { visible, overflowCount } = selectVisibleToasts({ toasts: [] });
    expect(visible).toEqual([]);
    expect(overflowCount).toBe(0);
  });

  it("treats a zero cap as nothing visible, everything overflow", () => {
    const { visible, overflowCount } = selectVisibleToasts({
      toasts: ["a", "b"],
      cap: 0,
    });
    expect(visible).toEqual([]);
    expect(overflowCount).toBe(2);
  });

  it("clamps a negative cap to zero", () => {
    const { visible, overflowCount } = selectVisibleToasts({
      toasts: ["a", "b"],
      cap: -5,
    });
    expect(visible).toEqual([]);
    expect(overflowCount).toBe(2);
  });
});
