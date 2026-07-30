/**
 * Shared helper for embedding the latest free-text update of a domain object
 * (an incident update, a maintenance update, ...) into a notification body.
 * Both `incident-backend` and `maintenance-backend` post subscriber
 * notifications and want parity here, so the normalization/truncation logic
 * lives once in this platform-level `*-common` rather than being replicated per
 * domain backend.
 *
 * ## The message is MARKDOWN, not literal text
 *
 * Update messages are authored as markdown and render as markdown on the web,
 * so a notification that shows the raw `[text](url)` source instead of the link
 * is a bug (reported: an email showed the escaped markdown of a link). This
 * helper therefore preserves the author's markdown rather than escaping it.
 *
 * Safety comes from the RENDERERS, not from mangling the source here - the same
 * arrangement the platform already relies on for the notification title and the
 * incident/maintenance descriptions, which are interpolated into the body
 * unescaped:
 *
 * - The only strategy that produces HTML is SMTP, via `markdownToHtml`, which
 *   runs an email-safe allow-list (drops `<script>`, `on*=` handlers, and
 *   `javascript:`/`data:` URLs; keeps only `http`/`https`/`mailto` links).
 * - Every other strategy renders the body as markdown / mrkdwn / an adaptive
 *   card, or flattens it to plain text - none execute HTML.
 *
 * So authored formatting (links, emphasis, lists, code) renders, while active
 * content cannot. Do NOT reintroduce source-side escaping to "defend" a future
 * strategy: a strategy that renders the body as raw, unsanitized HTML would be
 * the bug, and escaping here would silently destroy every author's formatting
 * to paper over it.
 *
 * What this helper still guarantees, because renderers can't:
 * - non-whitespace C0/C1 control characters (NUL, ESC, BEL, DEL, ...) are
 *   stripped - they are never legitimate authored content;
 * - runs of blank lines are collapsed so a message can't pad itself with a wall
 *   of vertical space;
 * - CROSS-ENTITY MENTIONS are flattened to their label (see below);
 * - the message is length-bounded.
 *
 * ## Why mentions are flattened rather than linked
 *
 * A `#` mention is authored as `[Label](checkstack:incident/<id>)` - an
 * internal scheme only a Checkstack renderer understands. Notification channels
 * do NOT understand it, and each leaks it differently: the email sanitiser
 * drops the href and leaves a dead `<a>`, while Slack's mrkdwn emits
 * `<checkstack:incident/123|Label>` and shows the internal URI to the
 * recipient. Discord, Telegram and Teams render markdown natively and would
 * pass the raw link straight through.
 *
 * So the link is removed here, at the one point every channel's body flows
 * through, and only the author's label survives. Linking instead would mean
 * resolving a per-RECIPIENT URL - and, to be correct, a per-recipient
 * permission check - inside a fan-out that has neither. The notification
 * already carries an `action` deep-link to the item it is about; a reader who
 * opens it sees the mention there as a live, viewability-checked link.
 */

import { rewriteMentions } from "@checkstack/common";

/**
 * A resolver that links nothing. Notification bodies have no context in which
 * a `checkstack:` reference could be followed, so every mention flattens.
 */
const NEVER_LINKABLE = (): string | undefined => undefined;

/** Longest update excerpt embedded in a notification body (chars). */
export const MAX_UPDATE_MESSAGE_LENGTH = 500;

/**
 * Non-whitespace control characters to strip from user text: C0 (0x00-0x1F)
 * and C1 (0x80-0x9F) plus DEL (0x7F), but PRESERVING tab (0x09) and newline
 * (0x0A) so authored line structure (paragraphs, lists) survives. Carriage
 * returns are normalized to newlines before this runs, so 0x0D never reaches
 * it.
 */
// eslint-disable-next-line no-control-regex -- intentional: strip control chars
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

/**
 * Normalize a user-supplied markdown update message for embedding in a
 * notification body: normalize line endings, strip non-whitespace control
 * characters (keeping newlines/tabs), collapse excess blank lines, trim, and
 * truncate to a bounded length. The markdown itself is left intact - see the
 * module doc for why escaping it here would be wrong. Returns `undefined` when
 * the message is absent or blank so callers can omit it entirely.
 */
export function sanitizeUpdateMessage(message?: string): string | undefined {
  if (typeof message !== "string") return undefined;
  // 0. Flatten cross-entity mentions to their label BEFORE anything else, so
  //    no channel ever sees the internal `checkstack:` scheme - and so the
  //    length bound below is spent on visible text rather than on an internal
  //    URI the reader will never see.
  const withoutMentions = rewriteMentions({
    markdown: message,
    // No context here can host a link, so nothing resolves - every mention
    // flattens to its label.
    resolve: NEVER_LINKABLE,
  });
  const normalized = withoutMentions
    // 1. Normalize CRLF / lone CR to LF so line handling is uniform.
    .replaceAll(/\r\n?/gu, "\n")
    // 2. Strip non-whitespace control chars, keeping tab + newline.
    .replaceAll(CONTROL_CHARS, "")
    // 3. Collapse 3+ consecutive newlines to a single blank line - a message
    //    can't pad itself out with a wall of vertical space.
    .replaceAll(/\n{3,}/gu, "\n\n")
    // 4. Drop trailing spaces/tabs on each line, then overall.
    .replaceAll(/[ \t]+$/gmu, "")
    .trim();
  if (normalized.length === 0) return undefined;
  const isTruncated = normalized.length > MAX_UPDATE_MESSAGE_LENGTH;
  const clipped = isTruncated
    ? normalized.slice(0, MAX_UPDATE_MESSAGE_LENGTH).trimEnd()
    : normalized;
  return isTruncated ? `${clipped}...` : clipped;
}

/**
 * Build the suffix appended to a notification body for the latest update
 * message: the normalized markdown as its own block, separated from the
 * preceding sentence by a blank line. Returns `""` when there is no usable
 * message (absent/blank) so callers can unconditionally concatenate the result.
 */
export function buildUpdateMessageSuffix(props: {
  message?: string;
}): string {
  const sanitized = sanitizeUpdateMessage(props.message);
  return sanitized ? `\n\n${sanitized}` : "";
}
