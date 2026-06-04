/**
 * Pure, DOM-free helpers for auto-titling a new conversation from its first user
 * message. Both functions are total (never throw) so the fire-and-forget title
 * job can always fall back to a deterministic heuristic when the model errors.
 */

/** Max words kept in a derived/sanitized title. */
const MAX_TITLE_WORDS = 6;
/** Hard character cap for a title (keeps the sidebar tidy). */
const MAX_TITLE_CHARS = 60;

/**
 * Collapse runs of whitespace into single spaces and trim the ends. Shared by
 * both helpers so titles never carry newlines or doubled spaces from the raw
 * model/user text.
 */
function collapseWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Cap a single-line string to at most `MAX_TITLE_WORDS` words AND
 * `MAX_TITLE_CHARS` characters, trimming any trailing whitespace left after the
 * cut. No ellipsis is appended (the task forbids ellipsis-from-cut weirdness).
 */
function capLength(value: string): string {
  const words = value.split(" ").slice(0, MAX_TITLE_WORDS).join(" ");
  if (words.length <= MAX_TITLE_CHARS) return words;
  return words.slice(0, MAX_TITLE_CHARS).trimEnd();
}

/**
 * Derive a deterministic fallback title from the first user message: collapse
 * whitespace, take the first ~6 words, cap at ~60 chars. Returns an empty string
 * only for empty/whitespace-only input (the caller leaves the title unset in
 * that case so the sidebar keeps showing "Untitled chat").
 */
export function deriveHeuristicTitle(firstMessage: string): string {
  const normalized = collapseWhitespace(firstMessage);
  if (!normalized) return "";
  return capLength(normalized);
}

/**
 * Sanitize a model-generated title: strip surrounding quotes, leading markdown
 * heading/list markers and bold/italic markers, collapse whitespace, drop
 * trailing punctuation, and cap length. Returns an empty string when nothing
 * usable remains so the caller can fall back to the heuristic.
 */
export function sanitizeGeneratedTitle(raw: string): string {
  // Take only the first non-empty line of a multi-line model reply BEFORE
  // collapsing whitespace (collapsing would erase the line breaks).
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  let value = collapseWhitespace(firstLine ?? "");
  if (!value) return "";

  // Strip leading markdown heading (#) and list markers (-, *, +, 1.).
  value = value.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+\.\s+)/, "");

  // Strip surrounding matching quotes (straight or smart) repeatedly.
  value = stripWrappingQuotes(value);

  // Remove markdown emphasis markers anywhere (**, __, *, _, `).
  value = value.replaceAll(/[*_`]+/g, "");

  // Collapse again after marker removal, then strip trailing punctuation.
  value = collapseWhitespace(value).replace(/[.,!?;:]+$/, "");
  value = value.trim();
  if (!value) return "";

  return capLength(value);
}

/** Strip one or more layers of matching wrapping quotes from a string. */
function stripWrappingQuotes(value: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["`", "`"],
  ];
  let current = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (
        current.length >= 2 &&
        current.startsWith(open) &&
        current.endsWith(close)
      ) {
        current = current.slice(open.length, current.length - close.length).trim();
        changed = true;
      }
    }
  }
  return current;
}
