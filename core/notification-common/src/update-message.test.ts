import { describe, it, expect } from "bun:test";
import { buildMentionMarkdown } from "@checkstack/common";
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

describe("cross-entity mentions never reach a channel", () => {
  const mention = (label = "Database upgrade", id = "9f1c-abc") =>
    buildMentionMarkdown({ type: "maintenance", id, label });

  it("flattens a mention to its label", () => {
    // REGRESSION: `checkstack:` is an internal scheme. Slack's mrkdwn happily
    // emitted `<checkstack:maintenance/9f1c-abc|Database upgrade>`, showing the
    // internal URI to the recipient; the email sanitiser left a dead `<a>`.
    const out = sanitizeUpdateMessage(`Rolled back. See ${mention()}.`);

    expect(out).toBe("Rolled back. See Database upgrade.");
  });

  it("no output retains the internal scheme, whatever the message", () => {
    for (const message of [
      mention(),
      `before ${mention()} after`,
      `${mention()} ${mention("Other", "m2")}`,
      `- item ${mention()}\n- second`,
      `> quoted ${mention()}`,
    ]) {
      expect(sanitizeUpdateMessage(message)).not.toContain("checkstack:");
    }
  });

  it("the suffix a caller appends carries no scheme either", () => {
    expect(
      buildUpdateMessageSuffix({ message: `See ${mention()}` }),
    ).toBe("\n\nSee Database upgrade");
  });

  it("ORDINARY links still survive - only mentions are flattened", () => {
    // The original reported bug was links arriving escaped; that must not
    // regress while fixing the mention leak.
    const message = "See [the runbook](https://example.com/rb) and fix it.";

    expect(sanitizeUpdateMessage(message)).toBe(message);
  });

  it("the length bound is spent on VISIBLE text, not the internal URI", () => {
    // Flattening happens before truncation, so a long internal href no longer
    // eats the budget and truncates the words the reader actually sees.
    const long = "x".repeat(MAX_UPDATE_MESSAGE_LENGTH - 20);
    const out = sanitizeUpdateMessage(`${long} ${mention("Short", "a".repeat(80))}`);

    expect(out).toContain("Short");
    expect(out).not.toContain("...");
  });

  it("a message that is ONLY a mention keeps its label", () => {
    expect(sanitizeUpdateMessage(mention())).toBe("Database upgrade");
  });

  it("a mention with a bracketed title stays literal text", () => {
    const out = sanitizeUpdateMessage(
      buildMentionMarkdown({
        type: "incident",
        id: "i1",
        label: "Outage [EU-West]",
      }),
    );

    // Escapes are preserved, so a markdown renderer shows the brackets rather
    // than starting a new link.
    expect(out).toBe(String.raw`Outage \[EU-West\]`);
  });
});
