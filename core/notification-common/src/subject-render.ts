import type { NotificationSubject, SubjectStatus } from "./schemas";

/**
 * Emoji used to prefix an affected subject in a rendered notification, keyed
 * by the subject's health status. Strategy plugins that render notifications
 * in text channels (Slack, Discord, Teams, Telegram, Webex, Gotify, ...) use
 * this map (directly, or via the helpers below) instead of redefining their
 * own, so operators see a consistent visual language across destinations.
 */
export const SUBJECT_STATUS_EMOJI: Record<SubjectStatus, string> = {
  healthy: "🟢",
  degraded: "🟡",
  unhealthy: "🔴",
  unknown: "⚪",
};

/** Default leading bullet used when a subject carries no status hint. */
const DEFAULT_BULLET = "•";

/**
 * The per-subject leading marker: the status emoji when a status hint is
 * present, otherwise the plain bullet. Honors the "never silent omission"
 * contract by always emitting a marker.
 */
function subjectMarker({
  subject,
  bullet,
}: {
  subject: NotificationSubject;
  bullet: string;
}): string {
  return subject.status ? SUBJECT_STATUS_EMOJI[subject.status] : bullet;
}

/**
 * Join an optional heading with the rendered subject lines, or return an
 * empty string when there are no subjects.
 */
function withHeading({
  heading,
  lines,
}: {
  heading: string | null;
  lines: string[];
}): string {
  if (lines.length === 0) return "";
  const body = lines.join("\n");
  return heading ? `${heading}\n${body}` : body;
}

/**
 * Render the affected `subjects` as a plain-text bullet list. URLs are shown
 * in parentheses after the name (text channels cannot render links). This is
 * the documented canonical fallback (`Affected:\n• Name (url)`) previously
 * reimplemented by every text-only strategy plugin.
 *
 * Returns an empty string for an empty list so callers can append
 * unconditionally.
 */
export function renderSubjectsAsPlainText({
  subjects,
  bullet = DEFAULT_BULLET,
  heading = "Affected:",
}: {
  subjects: NotificationSubject[];
  /** Leading bullet for subjects without a status hint. Defaults to "•". */
  bullet?: string;
  /** Heading line above the list, or `null` to omit it. */
  heading?: string | null;
}): string {
  const lines = subjects.map((subject) => {
    const marker = subjectMarker({ subject, bullet });
    const namePart = subject.url
      ? `${subject.name} (${subject.url})`
      : subject.name;
    return `${marker} ${namePart}`;
  });
  return withHeading({ heading, lines });
}

/**
 * The per-subject leading marker followed by the subject's name, with no URL,
 * heading, or list wrapping. Used by rich-card channels (e.g. Teams) that lay
 * out the URL in their own structure (a FactSet value, a button) but still want
 * the consistent status-emoji-or-bullet prefix in front of the name.
 *
 * Returns just `"<marker> <name>"`.
 */
export function renderSubjectLabel({
  subject,
  bullet = DEFAULT_BULLET,
}: {
  subject: NotificationSubject;
  /** Leading bullet when the subject carries no status hint. Defaults to "•". */
  bullet?: string;
}): string {
  return `${subjectMarker({ subject, bullet })} ${subject.name}`;
}

/**
 * Escape the five characters that are unsafe to interpolate into HTML text or
 * a double-quoted attribute value. Mirrors the escaping the email layout
 * applies so HTML notification channels never emit malformed or injectable
 * markup when a subject name or URL contains markup characters.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render the affected `subjects` as an HTML fragment for channels that accept a
 * constrained HTML subset (e.g. Pushover). Subjects with a URL become anchor
 * tags; the leading status marker prefixes each item. Names and URLs are
 * HTML-escaped.
 *
 * The default wrapping reproduces the canonical Pushover fallback
 * (`<b>Affected:</b><ul>...<li>...</li></ul>`). The `<ul>` already supplies the
 * list bullet, so there is no leading marker by default; a status emoji is
 * prefixed only when the subject carries a status hint. Returns an empty string
 * for an empty list so callers can append unconditionally.
 */
export function renderSubjectsAsHtml({
  subjects,
  heading = "<b>Affected:</b>",
}: {
  subjects: NotificationSubject[];
  /** HTML heading rendered before the list, or `null` to omit it. */
  heading?: string | null;
}): string {
  if (subjects.length === 0) return "";
  const items = subjects
    .map((subject) => {
      // The <ul> renders its own bullet, so we only prefix the status emoji
      // when present; status-less subjects render as the bare (escaped) name.
      const prefix = subject.status
        ? `${SUBJECT_STATUS_EMOJI[subject.status]} `
        : "";
      const name = escapeHtml(subject.name);
      const inner = subject.url
        ? `<a href="${escapeHtml(subject.url)}">${name}</a>`
        : name;
      return `<li>${prefix}${inner}</li>`;
    })
    .join("");
  const list = `<ul>${items}</ul>`;
  return heading ? `${heading}${list}` : list;
}

/** Inline-link syntaxes supported by {@link renderSubjectsAsMarkdown}. */
export type SubjectLinkStyle = "markdown" | "slack";

/**
 * Render the affected `subjects` as a markdown (or Slack mrkdwn) bullet list.
 * `linkStyle: "markdown"` produces `[name](url)`; `linkStyle: "slack"`
 * produces `<url|name>`. Subjects without a URL render as the bare name.
 *
 * Returns an empty string for an empty list so callers can append
 * unconditionally.
 */
export function renderSubjectsAsMarkdown({
  subjects,
  linkStyle = "markdown",
  bullet = DEFAULT_BULLET,
  heading,
}: {
  subjects: NotificationSubject[];
  /** Inline-link syntax. Defaults to standard markdown `[name](url)`. */
  linkStyle?: SubjectLinkStyle;
  /** Leading bullet for subjects without a status hint. Defaults to "•". */
  bullet?: string;
  /**
   * Heading line above the list, or `null` to omit it. Defaults to a bold
   * heading whose syntax matches `linkStyle` (`**Affected:**` for markdown,
   * `*Affected:*` for Slack mrkdwn).
   */
  heading?: string | null;
}): string {
  const resolvedHeading =
    heading === undefined
      ? linkStyle === "slack"
        ? "*Affected:*"
        : "**Affected:**"
      : heading;

  const lines = subjects.map((subject) => {
    const marker = subjectMarker({ subject, bullet });
    const namePart = subject.url
      ? linkStyle === "slack"
        ? `<${subject.url}|${subject.name}>`
        : `[${subject.name}](${subject.url})`
      : subject.name;
    return `${marker} ${namePart}`;
  });
  return withHeading({ heading: resolvedHeading, lines });
}
