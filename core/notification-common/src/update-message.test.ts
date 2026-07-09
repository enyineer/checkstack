import { describe, it, expect } from "bun:test";
import {
  sanitizeUpdateMessage,
  buildUpdateMessageSuffix,
  MAX_UPDATE_MESSAGE_LENGTH,
} from "./update-message";

describe("sanitizeUpdateMessage", () => {
  it("returns undefined for absent or blank input", () => {
    expect(sanitizeUpdateMessage(undefined)).toBeUndefined();
    expect(sanitizeUpdateMessage("")).toBeUndefined();
    expect(sanitizeUpdateMessage("   \n\t  ")).toBeUndefined();
  });

  it("collapses whitespace/newlines to a single line", () => {
    expect(sanitizeUpdateMessage("line one\n\nline two\ninjected")).toBe(
      "line one line two injected",
    );
  });

  it("strips non-whitespace control characters (ESC/NUL/BEL/DEL)", () => {
    const out = sanitizeUpdateMessage("before\u001B\u0000\u0007\u007Fafter");
    expect(out).toBe("beforeafter");
    expect(/[\u0000-\u001F\u007F-\u009F]/u.test(out ?? "")).toBe(false);
  });

  it("escapes markdown control characters", () => {
    const out = sanitizeUpdateMessage("See [here](http://evil) **now** `code`");
    expect(out).not.toContain("[here](http://evil)");
    expect(out).not.toContain("**now**");
    expect(out).toContain("\\[here\\]");
    expect(out).toContain("\\*\\*now\\*\\*");
  });

  it("HTML-entity-encodes < and & so markup cannot be injected", () => {
    const out = sanitizeUpdateMessage("watch <img onerror=x> & <script>");
    expect(out).not.toContain("<");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&amp;");
  });

  it("truncates an over-long message and appends an indicator", () => {
    const out = sanitizeUpdateMessage("a".repeat(1000));
    expect(out?.endsWith("...")).toBe(true);
    expect((out ?? "").length).toBeLessThanOrEqual(MAX_UPDATE_MESSAGE_LENGTH + 3);
  });
});

describe("buildUpdateMessageSuffix", () => {
  it("wraps a usable message in a leading blockquote suffix", () => {
    expect(buildUpdateMessageSuffix({ message: "hello world" })).toBe(
      "\n\n> hello world",
    );
  });

  it("returns an empty string for absent or blank messages", () => {
    expect(buildUpdateMessageSuffix({ message: undefined })).toBe("");
    expect(buildUpdateMessageSuffix({ message: "  \n  " })).toBe("");
  });
});
