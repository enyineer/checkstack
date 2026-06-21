/**
 * Date / time formatting helpers.
 *
 * All helpers use the runtime locale (we pass `undefined` as the locale to the
 * `Intl` / `toLocale*` APIs instead of hardcoding `"en-US"`), so values render
 * in the user's preferred locale. They accept a `Date`, an ISO/parseable
 * string, or a numeric epoch (milliseconds) and return an empty string for
 * absent or invalid input so callers never surface "Invalid Date" in the UI.
 */

export type DateInput = Date | string | number;

/** Coerce a {@link DateInput} into a valid `Date`, or `null` if unparseable. */
function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Default options for a short human-readable date (e.g. "Jan 5, 2025"). */
const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** Default options for a short human-readable date with time of day. */
const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Default options for a 24-hour time-of-day with seconds (e.g. "14:30:05"). */
const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * Format a date value as a short, locale-aware date string (e.g. "Jan 5,
 * 2025"). Returns an empty string for absent or invalid input.
 */
export function formatDate(value: DateInput | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(undefined, DATE_FORMAT_OPTIONS);
}

/**
 * Format a date value as a short, locale-aware date-and-time string (e.g.
 * "Jan 5, 2025, 02:30 PM"). Returns an empty string for absent or invalid
 * input.
 */
export function formatDateTime(value: DateInput | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(undefined, DATE_TIME_FORMAT_OPTIONS);
}

/**
 * Format a date value as a locale-aware 24-hour time-of-day string with
 * seconds (e.g. "14:30:05"). Returns an empty string for absent or invalid
 * input.
 */
export function formatTime(value: DateInput | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(undefined, TIME_FORMAT_OPTIONS);
}
