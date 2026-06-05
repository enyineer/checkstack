import { describe, expect, it } from "bun:test";
import { createScrollback } from "./scrollback.ts";

describe("createScrollback", () => {
  it("stores appended lines in order", () => {
    const sb = createScrollback({ capacity: 10 });
    sb.append({ text: "first", level: "info" });
    sb.append({ text: "second", level: "warn" });
    expect(sb.lines().map((entry) => entry.text)).toEqual(["first", "second"]);
  });

  it("caps at capacity, dropping the oldest lines", () => {
    const sb = createScrollback({ capacity: 3 });
    for (let i = 1; i <= 5; i++) {
      sb.append({ text: `l${i}`, level: "info" });
    }
    expect(sb.lines().map((entry) => entry.text)).toEqual(["l3", "l4", "l5"]);
  });

  it("reports the total number of lines ever appended", () => {
    const sb = createScrollback({ capacity: 2 });
    sb.append({ text: "a", level: "info" });
    sb.append({ text: "b", level: "info" });
    sb.append({ text: "c", level: "info" });
    expect(sb.size()).toBe(2);
    expect(sb.totalAppended()).toBe(3);
  });

  it("returns a windowed slice for the viewport, tailing by default", () => {
    const sb = createScrollback({ capacity: 100 });
    for (let i = 1; i <= 10; i++) {
      sb.append({ text: `l${i}`, level: "info" });
    }
    // tail window of height 3 -> last 3 lines
    const view = sb.window({ height: 3, scrollOffset: 0 });
    expect(view.map((entry) => entry.text)).toEqual(["l8", "l9", "l10"]);
  });

  it("scrolls back by the given offset", () => {
    const sb = createScrollback({ capacity: 100 });
    for (let i = 1; i <= 10; i++) {
      sb.append({ text: `l${i}`, level: "info" });
    }
    const view = sb.window({ height: 3, scrollOffset: 2 });
    expect(view.map((entry) => entry.text)).toEqual(["l6", "l7", "l8"]);
  });

  it("clamps a scroll offset that exceeds the history", () => {
    const sb = createScrollback({ capacity: 100 });
    for (let i = 1; i <= 5; i++) {
      sb.append({ text: `l${i}`, level: "info" });
    }
    const view = sb.window({ height: 3, scrollOffset: 999 });
    expect(view.map((entry) => entry.text)).toEqual(["l1", "l2", "l3"]);
  });

  it("returns all lines when the viewport is taller than the history", () => {
    const sb = createScrollback({ capacity: 100 });
    sb.append({ text: "only", level: "warn" });
    const view = sb.window({ height: 10, scrollOffset: 0 });
    expect(view.map((entry) => entry.text)).toEqual(["only"]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => createScrollback({ capacity: 0 })).toThrow();
  });
});

describe("clampScrollOffset", () => {
  it("is exercised indirectly via window()", () => {
    const sb = createScrollback({ capacity: 100 });
    for (let i = 1; i <= 4; i++) {
      sb.append({ text: `l${i}`, level: "info" });
    }
    // maxOffset = size(4) - height(2) = 2
    expect(
      sb.window({ height: 2, scrollOffset: 2 }).map((entry) => entry.text),
    ).toEqual(["l1", "l2"]);
    expect(
      sb.window({ height: 2, scrollOffset: 3 }).map((entry) => entry.text),
    ).toEqual(["l1", "l2"]);
  });
});
