import { describe, expect, it } from "bun:test";
import { stripAnsi, createLineSplitter } from "./text.ts";

const ESC = String.fromCharCode(27);

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi(`${ESC}[32minfo${ESC}[39m`)).toBe("info");
  });

  it("removes cursor and erase sequences", () => {
    expect(stripAnsi(`${ESC}[2Khello${ESC}[1G`)).toBe("hello");
  });

  it("removes a two-character escape", () => {
    expect(stripAnsi(`a${ESC}cb`)).toBe("ab");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("no codes here")).toBe("no codes here");
  });

  it("handles an empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("createLineSplitter", () => {
  it("splits a single chunk ending in a newline into one line", () => {
    const split = createLineSplitter();
    expect(split("hello\n")).toEqual(["hello"]);
  });

  it("buffers a partial line until the newline arrives", () => {
    const split = createLineSplitter();
    expect(split("hel")).toEqual([]);
    expect(split("lo\n")).toEqual(["hello"]);
  });

  it("emits multiple complete lines from one chunk", () => {
    const split = createLineSplitter();
    expect(split("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });

  it("keeps the trailing partial line buffered across chunks", () => {
    const split = createLineSplitter();
    expect(split("a\nb")).toEqual(["a"]);
    expect(split("c\n")).toEqual(["bc"]);
  });

  it("normalizes CRLF line endings", () => {
    const split = createLineSplitter();
    expect(split("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("strips a lone trailing carriage return inside a chunk", () => {
    const split = createLineSplitter();
    expect(split("progress\rdone\n")).toEqual(["progressdone"]);
  });

  it("flush() emits any buffered remainder without a newline", () => {
    const split = createLineSplitter();
    expect(split("dangling")).toEqual([]);
    expect(split.flush()).toEqual(["dangling"]);
  });

  it("flush() emits nothing when the buffer is empty", () => {
    const split = createLineSplitter();
    expect(split("a\n")).toEqual(["a"]);
    expect(split.flush()).toEqual([]);
  });
});
