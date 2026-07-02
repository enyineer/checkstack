import type { NotificationAction, NotificationSubject } from "./schemas";

/**
 * Matches a URL that already carries an absolute `http(s)://` scheme. Anchored
 * and case-insensitive so an already-qualified action/webhook URL is never
 * double-prefixed. Protocol-relative (`//host/...`) and other schemes are
 * intentionally NOT matched here; the only relative links this module
 * qualifies are the app's own `/path` deep links produced by producers.
 */
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

/**
 * Fully-qualify a single notification link against the instance's configured
 * base URL so it resolves in external channels (email, Slack, Teams, ...),
 * where a bare `/catalog/systems/...` path is meaningless.
 *
 * Semantics:
 * - An already-absolute `http(s)://` URL is returned unchanged.
 * - When `baseUrl` is missing/empty, the URL is returned unchanged (a sensible
 *   relative fallback, since delivering a relative link beats not delivering).
 * - Otherwise the base URL's trailing slash is collapsed and a single slash is
 *   ensured between base and path.
 */
export function toAbsoluteUrl({
  baseUrl,
  url,
}: {
  baseUrl?: string | null;
  url: string;
}): string {
  if (ABSOLUTE_URL_PATTERN.test(url)) return url;
  if (!baseUrl) return url;
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const separator = url.startsWith("/") ? "" : "/";
  return `${trimmedBase}${separator}${url}`;
}

/**
 * Return NEW `action` / `subjects` objects with every `.url` fully-qualified
 * against `baseUrl` via {@link toAbsoluteUrl}. The caller's input references are
 * never mutated (external delivery reuses the same payload across recipients and
 * strategies, so in-place mutation would leak a qualified URL back into the
 * shared payload). An `action` / `subject` without a `url` passes through
 * untouched.
 */
export function qualifyNotificationUrls({
  baseUrl,
  action,
  subjects,
}: {
  baseUrl?: string | null;
  action?: NotificationAction;
  subjects?: NotificationSubject[];
}): {
  action?: NotificationAction;
  subjects?: NotificationSubject[];
} {
  const qualifiedAction = action
    ? { ...action, url: toAbsoluteUrl({ baseUrl, url: action.url }) }
    : action;

  const qualifiedSubjects = subjects?.map((subject) =>
    subject.url === undefined
      ? subject
      : { ...subject, url: toAbsoluteUrl({ baseUrl, url: subject.url }) }
  );

  return { action: qualifiedAction, subjects: qualifiedSubjects };
}
