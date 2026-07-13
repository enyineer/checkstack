import type { StatTileTone } from "@checkstack/ui";

/** Cardinality usage at/above which the cap tile turns `warn`. */
export const SERIES_CAP_WARN_RATIO = 0.8;

/**
 * Series-cardinality usage as a fraction of the configured cap. Returns 0 when
 * the cap is not a positive number (a mis-configured / zero cap must never
 * divide-by-zero or read as "over capacity").
 */
export function seriesUsageRatio({
  seriesCount,
  seriesCap,
}: {
  seriesCount: number;
  seriesCap: number;
}): number {
  if (!Number.isFinite(seriesCap) || seriesCap <= 0) return 0;
  return seriesCount / seriesCap;
}

/**
 * Map a cardinality-usage ratio to a stat-tile tone: `down` once the cap is
 * reached (new series are being DROPPED), `warn` from 80% of the cap, else the
 * plain `default` foreground.
 */
export function seriesUsageTone(ratio: number): StatTileTone {
  if (ratio >= 1) return "down";
  if (ratio >= SERIES_CAP_WARN_RATIO) return "warn";
  return "default";
}

/** Whole-percent usage for display (e.g. "82%"), clamped at 0. */
export function seriesUsagePercent(ratio: number): number {
  return Math.max(0, Math.round(ratio * 100));
}
