/**
 * Date formatting helpers for catalog-frontend.
 *
 * Uses the browser/runtime locale (undefined) instead of a hardcoded "en-US"
 * so dates render in the user's preferred locale.
 */

/** Options used for human-readable catalog dates (e.g. "Jan 5, 2025"). */
const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/**
 * Format a date value as a short human-readable string using the runtime
 * locale. Accepts a `Date` object or an ISO string.
 *
 * Returns an empty string for invalid or absent dates so the caller never
 * shows "Invalid Date" in the UI.
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, DATE_FORMAT_OPTIONS);
}
