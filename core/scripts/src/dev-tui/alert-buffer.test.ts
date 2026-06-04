import { describe, expect, it } from "bun:test";
import { createAlertBuffer } from "./alert-buffer.ts";

describe("createAlertBuffer", () => {
  it("keeps only warn/error entries, newest first", () => {
    const buf = createAlertBuffer({ capacity: 8 });
    buf.push({ source: "backend", level: "info", text: "ignored", seq: 1 });
    buf.push({ source: "backend", level: "warn", text: "first", seq: 2 });
    buf.push({ source: "frontend", level: "error", text: "second", seq: 3 });

    const list = buf.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.text).toBe("second");
    expect(list[1]?.text).toBe("first");
  });

  it("ignores debug entries", () => {
    const buf = createAlertBuffer({ capacity: 8 });
    buf.push({ source: "backend", level: "debug", text: "noise", seq: 1 });
    expect(buf.list()).toHaveLength(0);
  });

  it("caps the buffer at the given capacity, dropping the oldest", () => {
    const buf = createAlertBuffer({ capacity: 3 });
    for (let i = 1; i <= 5; i++) {
      buf.push({ source: "backend", level: "warn", text: `w${i}`, seq: i });
    }
    const list = buf.list();
    expect(list).toHaveLength(3);
    // newest first: w5, w4, w3 (w1 and w2 dropped)
    expect(list.map((entry) => entry.text)).toEqual(["w5", "w4", "w3"]);
  });

  it("returns a defensive copy that callers cannot mutate", () => {
    const buf = createAlertBuffer({ capacity: 4 });
    buf.push({ source: "backend", level: "error", text: "boom", seq: 1 });
    const list = buf.list();
    list.pop();
    expect(buf.list()).toHaveLength(1);
  });

  it("preserves source and level on stored entries", () => {
    const buf = createAlertBuffer({ capacity: 4 });
    buf.push({ source: "frontend", level: "error", text: "bad", seq: 7 });
    const entry = buf.list()[0];
    expect(entry?.source).toBe("frontend");
    expect(entry?.level).toBe("error");
    expect(entry?.seq).toBe(7);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => createAlertBuffer({ capacity: 0 })).toThrow();
    expect(() => createAlertBuffer({ capacity: -3 })).toThrow();
  });

  it("clear() empties the buffer", () => {
    const buf = createAlertBuffer({ capacity: 4 });
    buf.push({ source: "backend", level: "warn", text: "w", seq: 1 });
    buf.clear();
    expect(buf.list()).toHaveLength(0);
  });
});
