/**
 * Relative-time formatting.
 *
 * The single engine for "x ago" strings is `date-fns`' `formatDistanceToNow`,
 * which is already a dependency of `@checkstack/ui`. Picking one engine keeps
 * relative-time wording consistent across the whole UI.
 */

import { formatDistanceToNow } from "date-fns";

import { type DateInput } from "./date";

/** Coerce a {@link DateInput} into a valid `Date`, or `null` if unparseable. */
function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Format a date relative to now using `date-fns` (e.g. "5 minutes ago",
 * "in 2 hours"). The trailing/leading "ago"/"in" suffix is included
 * (`addSuffix: true`). Returns an empty string for absent or invalid input.
 */
export function formatRelativeTime(value: DateInput | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return formatDistanceToNow(date, { addSuffix: true });
}
