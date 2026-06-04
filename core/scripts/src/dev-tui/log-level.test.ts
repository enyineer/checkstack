import { describe, expect, it } from "bun:test";
import { detectLogLevel, isAlertLevel } from "./log-level.ts";

const ESC = String.fromCharCode(27);

describe("detectLogLevel", () => {
  it("detects info from the winston dev format", () => {
    expect(detectLogLevel({ line: "21:02:49 info: server started" })).toBe(
      "info",
    );
  });

  it("detects warn from the winston dev format", () => {
    expect(
      detectLogLevel({ line: "21:02:49 warn: sandbox not ready" }),
    ).toBe("warn");
  });

  it("detects error from the winston dev format", () => {
    expect(detectLogLevel({ line: "09:00:01 error: boom" })).toBe("error");
  });

  it("detects debug from the winston dev format", () => {
    expect(detectLogLevel({ line: "09:00:01 debug: noisy detail" })).toBe(
      "debug",
    );
  });

  it("detects the level even when winston colorize wraps it in ANSI codes", () => {
    // winston colorize() output wraps the level token in SGR color codes.
    const line = `21:02:49 ${ESC}[32minfo${ESC}[39m: server started`;
    expect(detectLogLevel({ line })).toBe("info");
  });

  it("detects a colorized warn level", () => {
    const line = `21:02:49 ${ESC}[33mwarn${ESC}[39m: heads up`;
    expect(detectLogLevel({ line })).toBe("warn");
  });

  it("treats winston verbose/silly/http as debug-tier", () => {
    expect(detectLogLevel({ line: "21:02:49 verbose: trace" })).toBe("debug");
    expect(detectLogLevel({ line: "21:02:49 silly: trace" })).toBe("debug");
    expect(detectLogLevel({ line: "21:02:49 http: GET /" })).toBe("debug");
  });

  it("recognizes a bare level token without a leading timestamp", () => {
    expect(detectLogLevel({ line: "error: vite failed to start" })).toBe(
      "error",
    );
    expect(detectLogLevel({ line: "WARN: deprecated option" })).toBe("warn");
  });

  it("recognizes bracketed levels like [ERROR]", () => {
    expect(detectLogLevel({ line: "[ERROR] something broke" })).toBe("error");
    expect(detectLogLevel({ line: "VITE v8.0.0  [warning] foo" })).toBe(
      "warn",
    );
  });

  it("classifies vite errors that surface as the word Error", () => {
    expect(
      detectLogLevel({ line: "Error: Failed to resolve import" }),
    ).toBe("error");
  });

  it("defaults to info for plain unprefixed output", () => {
    expect(detectLogLevel({ line: "Local:   http://localhost:5173/" })).toBe(
      "info",
    );
  });

  it("defaults to info for an empty line", () => {
    expect(detectLogLevel({ line: "" })).toBe("info");
    expect(detectLogLevel({ line: "   " })).toBe("info");
  });

  it("does not misread the substring 'error' inside a word", () => {
    expect(
      detectLogLevel({ line: "21:02:49 info: cleared error cache" }),
    ).toBe("info");
  });
});

describe("isAlertLevel", () => {
  it("flags warn and error as alert levels", () => {
    expect(isAlertLevel("warn")).toBe(true);
    expect(isAlertLevel("error")).toBe(true);
  });

  it("does not flag info or debug", () => {
    expect(isAlertLevel("info")).toBe(false);
    expect(isAlertLevel("debug")).toBe(false);
  });
});
