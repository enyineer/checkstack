/**
 * Pure shaping helpers for a Prometheus scrape result. The transport (fetch,
 * SSRF guard, size cap) lives in the backend scrape executor; the shaping - the
 * per-scrape max-series cap - is pure and shared so both the core reconciler
 * and the satellite-side scraper apply the identical bound. Pure module: no IO.
 */

import type { NormalizedDatapoint } from "../../schemas";

/** Canonical series key for the per-scrape max-series cap. */
function seriesKey(dp: NormalizedDatapoint): string {
  const keys = Object.keys(dp.labels).toSorted();
  return `${dp.name}{${keys.map((k) => `${k}=${dp.labels[k]}`).join(",")}}`;
}

/**
 * Cap a datapoint list to at most `maxSeries` distinct series. Datapoints of the
 * first `maxSeries` distinct series (in first-seen order) are kept; the rest are
 * dropped. Returns the kept datapoints and how many distinct series were kept.
 */
export function capScrapeSeries({
  datapoints,
  maxSeries,
}: {
  datapoints: NormalizedDatapoint[];
  maxSeries: number;
}): { kept: NormalizedDatapoint[]; seriesCount: number } {
  const seen = new Set<string>();
  const kept: NormalizedDatapoint[] = [];
  for (const dp of datapoints) {
    const key = seriesKey(dp);
    if (!seen.has(key)) {
      if (seen.size >= maxSeries) continue;
      seen.add(key);
    }
    kept.push(dp);
  }
  return { kept, seriesCount: seen.size };
}
