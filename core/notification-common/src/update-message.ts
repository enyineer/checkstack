/**
 * Shared helper for embedding the latest free-text update of a domain object
 * (an incident update, a maintenance update, ...) into a notification body as a
 * safe, single-line blockquote. Both `incident-backend` and `maintenance-backend`
 * post subscriber notifications and want parity here, so the escaping/truncation
 * logic lives once in this platform-level `*-common` rather than being replicated
 * per domain backend.
 */

/** Longest update excerpt embedded in a notification body (chars). */
export const MAX_UPDATE_MESSAGE_LENGTH = 500;

/**
 * Non-whitespace control characters to strip from user text: C0 (0x00-0x1F),
 * DEL (0x7F), and C1 (0x80-0x9F). Whitespace controls are collapsed to a space
 * BEFORE this runs, so nothing printable (including plain spaces) is removed.
 */
// eslint-disable-next-line no-control-regex -- intentional: strip control chars
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Turn a user-supplied update message into a body-safe excerpt:
 * collapse whitespace/newlines to a single line (so it can't break out of the
 * blockquote), strip non-whitespace C0/C1 control characters (ESC, NUL, BEL,
 * DEL, ...), escape markdown control characters and the HTML-significant
 * `<`/`&` (so it can't inject formatting, links, or markup in any downstream
 * renderer), and truncate to a bounded length. Returns `undefined` when the
 * message is absent or blank so callers can omit the suffix entirely.
 */
export function sanitizeUpdateMessage(message?: string): string | undefined {
  if (typeof message !== "string") return undefined;
  // 1. Collapse ALL whitespace (tab/newline/CR/FF/VT/unicode spaces) to a
  //    single space, then 2. strip the remaining non-whitespace control chars
  //    (C0 0x00-0x1F, DEL 0x7F, C1 0x80-0x9F) - only plain spaces survive.
  const collapsed = message
    .replaceAll(/\s+/gu, " ")
    .replaceAll(CONTROL_CHARS, "")
    .trim();
  if (collapsed.length === 0) return undefined;
  const isTruncated = collapsed.length > MAX_UPDATE_MESSAGE_LENGTH;
  const clipped = isTruncated
    ? collapsed.slice(0, MAX_UPDATE_MESSAGE_LENGTH).trimEnd()
    : collapsed;
  // Escape so the message renders as literal text in every strategy: HTML-
  // entity-encode `&` (first, so we don't double-encode) and `<`, then escape
  // the markdown control characters. The truncation indicator is appended AFTER
  // escaping so it isn't escaped itself.
  const escaped = clipped
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(/([\\`*_{}[\]()#+\-.!>~|])/g, String.raw`\$1`);
  return isTruncated ? `${escaped}...` : escaped;
}

/**
 * Build the blockquote suffix appended to a notification body for the latest
 * update message. Returns `""` when there is no usable message (absent/blank)
 * so callers can unconditionally concatenate the result.
 */
export function buildUpdateMessageSuffix(props: {
  message?: string;
}): string {
  const sanitized = sanitizeUpdateMessage(props.message);
  return sanitized ? `\n\n> ${sanitized}` : "";
}
