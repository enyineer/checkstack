/**
 * Markdown conversion utilities for notification strategies.
 *
 * These utilities allow strategies to convert markdown content to their
 * native format (HTML for email, plain text for SMS, etc.).
 *
 * @module
 */

import { marked } from "marked";

// Configure marked for email-safe HTML
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
});

/**
 * Convert markdown to HTML (safe for email rendering).
 *
 * Uses GitHub Flavored Markdown with line break support.
 *
 * @example
 * ```typescript
 * const html = markdownToHtml("**Bold** and *italic*");
 * // Returns: "<p><strong>Bold</strong> and <em>italic</em></p>"
 * ```
 */
export function markdownToHtml(markdown: string): string {
  // marked.parse can return string | Promise<string>, but with sync config it's always string
  return marked.parse(markdown) as string;
}

/**
 * Strip markdown to plain text.
 *
 * Removes all formatting while preserving the content.
 * Useful for strategies that don't support rich formatting (SMS, push).
 *
 * @example
 * ```typescript
 * const text = markdownToPlainText("**Bold** and [link](https://example.com)");
 * // Returns: "Bold and link"
 * ```
 */
export function markdownToPlainText(markdown: string): string {
  // Convert to HTML first, then strip tags
  const html = markdownToHtml(markdown);

  // Strip HTML tags
  let text = html.replaceAll(/<[^>]*>/g, "");

  // Decode common HTML entities
  text = text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");

  // Collapse multiple whitespace/newlines
  text = text.replaceAll(/\n\s*\n/g, "\n").trim();

  return text;
}

/**
 * Convert markdown to Slack mrkdwn format.
 *
 * Slack uses a different markdown flavor with ~strikethrough~ syntax
 * and different link formatting.
 *
 * @example
 * ```typescript
 * const mrkdwn = markdownToSlackMrkdwn("**Bold** and [link](https://example.com)");
 * // Returns: "*Bold* and <https://example.com|link>"
 * ```
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  let result = markdown;

  // Convert strikethrough first: ~~text~~ -> ~text~
  result = result.replaceAll(/~~(.+?)~~/g, "~$1~");

  // Convert links: [text](url) -> <url|text>
  result = result.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert italic (single underscore only): _text_ -> _text_
  // Note: We skip *italic* conversion because Slack uses * for bold
  // and it would conflict with the **bold** -> *bold* conversion

  // Convert bold: **text** or __text__ -> *text*
  result = result.replaceAll(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replaceAll(/__(.+?)__/g, "*$1*");

  // Convert inline code: `code` -> `code` (same in Slack)
  // No change needed

  // Convert code blocks: ```code``` -> ```code``` (same in Slack)
  // No change needed

  return result;
}
