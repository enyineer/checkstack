/**
 * Human-readable duration formatting.
 *
 * Renders a millisecond duration as a compact "2h 5m" / "30s" style string.
 */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format a duration given in milliseconds as a compact human-readable string.
 *
 * Examples:
 * - `7_500_000` -> "2h 5m"
 * - `30_000` -> "30s"
 * - `500` -> "500ms"
 * - `0` -> "0s"
 *
 * At most the two most-significant non-zero units are shown (days, hours,
 * minutes, seconds). Sub-second durations are rendered in milliseconds.
 * Negative durations keep their sign. Returns an empty string for non-finite
 * input.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "";

  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);

  if (abs === 0) return "0s";
  if (abs < MS_PER_SECOND) return `${sign}${Math.round(abs)}ms`;

  const days = Math.floor(abs / MS_PER_DAY);
  const hours = Math.floor((abs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((abs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((abs % MS_PER_MINUTE) / MS_PER_SECOND);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  // Show at most the two most-significant non-zero units.
  return `${sign}${parts.slice(0, 2).join(" ")}`;
}
