import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

/**
 * Offline-tolerance choices offered in the satellite editor.
 *
 * A fixed list rather than a free-text millisecond field: the value is a
 * judgement about how flaky a link is, not a measurement, and every operator
 * reaching for it thinks in minutes or hours. `null` means "follow the platform
 * default", which is a real choice and therefore first in the list.
 */
export const OFFLINE_THRESHOLD_OPTIONS: {
  value: number | null;
  label: string;
}[] = [
  { value: null, label: `Default (${formatDuration(OFFLINE_THRESHOLD_MS)})` },
  { value: 2 * 60_000, label: "2 minutes" },
  { value: 5 * 60_000, label: "5 minutes" },
  { value: 10 * 60_000, label: "10 minutes" },
  { value: 15 * 60_000, label: "15 minutes" },
  { value: 30 * 60_000, label: "30 minutes" },
  { value: 60 * 60_000, label: "1 hour" },
  { value: 2 * 60 * 60_000, label: "2 hours" },
  { value: 6 * 60 * 60_000, label: "6 hours" },
  { value: 12 * 60 * 60_000, label: "12 hours" },
  { value: 24 * 60 * 60_000, label: "24 hours" },
];

/** Sentinel for the "use the default" option - Select cannot hold an empty value. */
export const DEFAULT_THRESHOLD_VALUE = "__default__";

/** Human duration for a millisecond span, to one unit. */
export function formatDuration(ms: number): string {
  if (ms >= 3_600_000) {
    const hours = ms / 3_600_000;
    return `${trimNumber(hours)} hour${hours === 1 ? "" : "s"}`;
  }
  if (ms >= 60_000) {
    const minutes = ms / 60_000;
    return `${trimNumber(minutes)} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = ms / 1000;
  return `${trimNumber(seconds)} second${seconds === 1 ? "" : "s"}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The Select value for a stored threshold.
 *
 * A stored value that is not one of the offered options (set via API or GitOps)
 * still has to round-trip, so it is surfaced as its own value rather than
 * silently snapping to the nearest option - which would change the satellite's
 * behaviour just because someone opened the dialog.
 */
export function toSelectValue({
  offlineThresholdMs,
}: {
  offlineThresholdMs?: number | null;
}): string {
  return offlineThresholdMs === undefined || offlineThresholdMs === null
    ? DEFAULT_THRESHOLD_VALUE
    : String(offlineThresholdMs);
}

/** Parse a Select value back to the wire form (`null` clears the override). */
export function fromSelectValue({ value }: { value: string }): number | null {
  return value === DEFAULT_THRESHOLD_VALUE ? null : Number(value);
}

/**
 * The options to render, including a stored custom value that is not one of
 * the presets, so it stays selected and visible.
 */
export function optionsWithCurrent({
  offlineThresholdMs,
}: {
  offlineThresholdMs?: number | null;
}): { value: number | null; label: string }[] {
  if (offlineThresholdMs === undefined || offlineThresholdMs === null) {
    return OFFLINE_THRESHOLD_OPTIONS;
  }
  const known = OFFLINE_THRESHOLD_OPTIONS.some(
    (option) => option.value === offlineThresholdMs,
  );
  if (known) return OFFLINE_THRESHOLD_OPTIONS;

  return [
    ...OFFLINE_THRESHOLD_OPTIONS,
    {
      value: offlineThresholdMs,
      label: `${formatDuration(offlineThresholdMs)} (custom)`,
    },
  ];
}
