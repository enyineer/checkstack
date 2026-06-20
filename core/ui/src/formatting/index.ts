/**
 * Shared, pure formatting helpers for the Checkstack UI.
 *
 * These are framework-agnostic (no React) and locale-aware (they pass an
 * `undefined` locale to `Intl` / `toLocale*` so output follows the runtime
 * locale rather than a hardcoded one). Use them instead of re-implementing
 * date / number / byte / percent / duration formatting inline.
 */

export { formatDate, formatDateTime, formatTime, type DateInput } from "./date";
export { formatRelativeTime } from "./relativeTime";
export {
  formatNumber,
  formatBytes,
  formatPercent,
  type FormatNumberOptions,
  type FormatBytesOptions,
  type FormatPercentOptions,
} from "./number";
export { formatDuration } from "./duration";
