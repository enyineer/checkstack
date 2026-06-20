/**
 * Markdown conversion utilities for notification strategies.
 *
 * These utilities allow strategies to convert markdown content to their
 * native format (HTML for email, plain text for SMS, etc.).
 *
 * @module
 */

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Configure marked for email-safe HTML
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
});

/**
 * Email-safe HTML sanitizer options.
 *
 * `marked` does NOT sanitize: a notification body can carry operator- or
 * user-influenced markdown (incident titles/descriptions, integration
 * payloads), so the rendered HTML could otherwise contain `<script>`,
 * `onerror=`, or `javascript:`/`data:` URLs that some email clients render as
 * active content. This allow-list mirrors the intent the frontend already
 * enforces with `rehype-sanitize`: keep ordinary formatting (emphasis, lists,
 * tables, links, code, headings) and strip everything that can execute.
 *
 * - Only `http`, `https`, and `mailto` schemes survive on `href` (and only
 *   `http`/`https` on image `src`), so `javascript:` / `data:` URLs are dropped.
 * - No `<script>`/`<style>`/`<iframe>` tags and no `on*` event-handler
 *   attributes are in the allow-list, so they are removed.
 */
const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "blockquote", "pre", "code", "span", "div",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "sub", "sup", "mark",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  ],
  allowedAttributes: {
    a: ["href", "name", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["align"],
    th: ["align"],
  },
  // Only safe URL schemes; this is what drops javascript:/data: URLs.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  // Force-disable protocol-relative URLs from being treated as same-origin.
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
};

/**
 * Strip active/unsafe HTML from a rendered fragment, keeping email-safe
 * formatting. Exported for reuse by HTML-producing notification helpers.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, EMAIL_SANITIZE_OPTIONS);
}

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
  // marked.parse can return string | Promise<string>, but with sync config it's
  // always string. `marked` does NOT sanitize, so the rendered HTML is passed
  // through an email-safe sanitizer before it can reach an email body: any
  // `<script>`, `on*=` handler, or `javascript:`/`data:` URL is removed.
  const rawHtml = marked.parse(markdown) as string;
  return sanitizeEmailHtml(rawHtml);
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

  // Decode HTML entities FIRST so any escaped markup like `&lt;script&gt;`
  // is exposed to the tag stripper in the next pass. `&amp;` must be
  // decoded last; otherwise `&amp;lt;` would round-trip to `<` and
  // reintroduce a control character (CodeQL js/double-escaping).
  let text = html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");

  // Strip HTML tags. Loop until the output stabilizes so adversarial inputs
  // like `<scr<script>ipt>` cannot leave a residual `<script>` substring
  // after a single pass (CodeQL js/incomplete-multi-character-sanitization).
  let previous: string;
  do {
    previous = text;
    text = text.replaceAll(/<[^>]*>/g, "");
  } while (text !== previous);

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
