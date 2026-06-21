/**
 * Pure, DOM-free helpers for the maintenance window-duration heroes.
 *
 * The premium list rows and the detail card lead with a number-led duration
 * figure ("2h 30m", "3d 4h", a live "time remaining" readout). These helpers
 * keep the formatting branches testable without rendering a component.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format a span of milliseconds as a compact, human window length using at
 * most the two most significant non-zero units (days, hours, minutes). A
 * sub-minute span renders as "< 1m"; a non-positive span renders as "0m".
 *
 * Examples: 90 minutes -> "1h 30m", 26 hours -> "1d 2h", 45 seconds -> "< 1m".
 */
export function formatWindowDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0m";
  }
  if (ms < MS_PER_MINUTE) {
    return "< 1m";
  }

  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  // Only show minutes when they add precision the larger units lack and we
  // have not already filled both slots (days + hours).
  if (minutes > 0 && parts.length < 2) parts.push(`${minutes}m`);

  return parts.slice(0, 2).join(" ");
}

/**
 * Compute the millisecond length of a window from its ISO/string/Date bounds.
 * Returns 0 when either bound is unparseable so callers always get a finite,
 * non-negative span.
 */
export function windowLengthMs({
  startAt,
  endAt,
}: {
  startAt: string | number | Date;
  endAt: string | number | Date;
}): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, end - start);
}
