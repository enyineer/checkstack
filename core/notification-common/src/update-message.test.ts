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

  it("PRESERVES authored markdown so it renders (the reported bug)", () => {
    // A link authored in an update used to arrive escaped - `\[text\]\(url\)` -
    // and render as raw text. It must survive intact so downstream renderers
    // turn it into a real link.
    const md = "See [the fix](https://example.com/incident/abc-123) for details.";
    expect(sanitizeUpdateMessage(md)).toBe(md);
  });

  it("leaves emphasis, code, and list markup untouched", () => {
    expect(sanitizeUpdateMessage("**bold** and `code`")).toBe(
      "**bold** and `code`",
    );
    expect(sanitizeUpdateMessage("- one\n- two")).toBe("- one\n- two");
  });

  it("preserves newlines so paragraphs and lists survive", () => {
    expect(sanitizeUpdateMessage("para one\n\npara two")).toBe(
      "para one\n\npara two",
    );
  });

  it("normalizes CRLF and lone CR to LF", () => {
    expect(sanitizeUpdateMessage("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("collapses 3+ blank lines to a single blank line", () => {
    expect(sanitizeUpdateMessage("top\n\n\n\n\nbottom")).toBe("top\n\nbottom");
  });

  it("strips non-whitespace control chars but keeps tab and newline", () => {
    // ESC/NUL/BEL/DEL between the words are removed; tab + newline survive.
    const out = sanitizeUpdateMessage("before\u001B\u0000\u0007\u007Fafter\tx\ny");
    expect(out).toBe("beforeafter\tx\ny");
    // No C0/C1 controls other than tab (0x09) and newline (0x0A) remain.
    expect(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(out ?? "")).toBe(
      false,
    );
  });

  it("does NOT HTML-escape < or & (the email renderer sanitizes instead)", () => {
    // Kept as authored markdown; markdownToHtml's allow-list is what strips a
    // real <script>, so escaping here would only mangle legitimate text.
    const out = sanitizeUpdateMessage("a < b && c");
    expect(out).toBe("a < b && c");
  });

  it("truncates an over-long message and appends an indicator", () => {
    const out = sanitizeUpdateMessage("a".repeat(1000));
    expect(out?.endsWith("...")).toBe(true);
    expect((out ?? "").length).toBeLessThanOrEqual(MAX_UPDATE_MESSAGE_LENGTH + 3);
  });
});

describe("buildUpdateMessageSuffix", () => {
  it("appends a usable message as its own markdown block", () => {
    expect(buildUpdateMessageSuffix({ message: "hello **world**" })).toBe(
      "\n\nhello **world**",
    );
  });

  it("preserves multi-line structure in the block", () => {
    expect(buildUpdateMessageSuffix({ message: "line one\nline two" })).toBe(
      "\n\nline one\nline two",
    );
  });

  it("returns an empty string for absent or blank messages", () => {
    expect(buildUpdateMessageSuffix({ message: undefined })).toBe("");
    expect(buildUpdateMessageSuffix({ message: "  \n  " })).toBe("");
  });
});
