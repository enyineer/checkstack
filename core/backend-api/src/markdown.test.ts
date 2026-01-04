import { describe, expect, it } from "bun:test";
import {
  markdownToHtml,
  markdownToPlainText,
  markdownToSlackMrkdwn,
} from "./markdown";

describe("markdownToHtml", () => {
  it("converts bold text", () => {
    const result = markdownToHtml("**bold**");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("converts italic text", () => {
    const result = markdownToHtml("*italic*");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    const result = markdownToHtml("[link](https://example.com)");
    expect(result).toContain('<a href="https://example.com">link</a>');
  });

  it("converts headers", () => {
    const result = markdownToHtml("# Header");
    expect(result).toContain("<h1");
    expect(result).toContain("Header");
  });

  it("converts unordered lists", () => {
    const result = markdownToHtml("- item 1\n- item 2");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>item 1</li>");
    expect(result).toContain("<li>item 2</li>");
  });

  it("converts code blocks", () => {
    const result = markdownToHtml("```\ncode\n```");
    expect(result).toContain("<code>");
  });

  it("converts inline code", () => {
    const result = markdownToHtml("use `code` here");
    expect(result).toContain("<code>code</code>");
  });
});

describe("markdownToPlainText", () => {
  it("strips bold formatting", () => {
    const result = markdownToPlainText("**bold** text");
    expect(result).toBe("bold text");
  });

  it("strips italic formatting", () => {
    const result = markdownToPlainText("*italic* text");
    expect(result).toBe("italic text");
  });

  it("strips links but keeps text", () => {
    const result = markdownToPlainText("[link](https://example.com)");
    expect(result).toBe("link");
  });

  it("strips headers", () => {
    const result = markdownToPlainText("# Header");
    expect(result).toBe("Header");
  });

  it("preserves line breaks between paragraphs", () => {
    const result = markdownToPlainText("First paragraph.\n\nSecond paragraph.");
    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
  });

  it("decodes HTML entities", () => {
    const result = markdownToPlainText("A &amp; B");
    expect(result).toBe("A & B");
  });
});

describe("markdownToSlackMrkdwn", () => {
  it("converts bold to Slack format", () => {
    const result = markdownToSlackMrkdwn("**bold**");
    expect(result).toBe("*bold*");
  });

  it("converts double underscore to Slack bold", () => {
    const result = markdownToSlackMrkdwn("__bold__");
    expect(result).toBe("*bold*");
  });

  it("converts links to Slack format", () => {
    const result = markdownToSlackMrkdwn("[link](https://example.com)");
    expect(result).toBe("<https://example.com|link>");
  });

  it("converts strikethrough", () => {
    const result = markdownToSlackMrkdwn("~~strikethrough~~");
    expect(result).toBe("~strikethrough~");
  });

  it("preserves inline code", () => {
    const result = markdownToSlackMrkdwn("`code`");
    expect(result).toBe("`code`");
  });
});
