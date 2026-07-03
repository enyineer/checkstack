/**
 * Anomaly-baseline presentation logic shared by the latency hero chart and the
 * auto-generated metric tiles: baseline lookup (with aggregated-name
 * fallbacks), the "expected" band, the trend/drift projection, and the header
 * chip strings. Pure and framework-free (see `baseline.logic.test.ts`).
 *
 * Lives in healthcheck-frontend (not `@checkstack/ui`) because it speaks
 * `AnomalyBaselineDto` — the UI kit sits below anomaly-common in the layering.
 */

import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";

/**
 * Find the baseline for a field. Tries the exact aggregated field path first,
 * then maps aggregated names back to their raw counterparts (`avgLatencyMs` →
 * `latencyMs`, `successRate` → `success`), because baselines are learned on
 * RAW run fields while charts render AGGREGATED schema fields.
 */
export function matchBaseline({
  baselines,
  fieldName,
  collectorId,
}: {
  baselines: ReadonlyArray<AnomalyBaselineDto>;
  fieldName: string;
  collectorId?: string;
}): AnomalyBaselineDto | undefined {
  const pathFor = (name: string) =>
    collectorId === undefined ? name : `collectors.${collectorId}.${name}`;

  const exact = baselines.find((b) => b.fieldPath === pathFor(fieldName));
  if (exact !== undefined) return exact;

  let rawFieldName = fieldName;
  if (
    fieldName.startsWith("avg") ||
    fieldName.startsWith("min") ||
    fieldName.startsWith("max")
  ) {
    rawFieldName = fieldName.charAt(3).toLowerCase() + fieldName.slice(4);
  } else if (fieldName === "successRate") {
    rawFieldName = "success";
  }
  if (rawFieldName === fieldName) return undefined;

  return baselines.find((b) => b.fieldPath === pathFor(rawFieldName));
}

/** The μ ± 3σ/√n̄ "expected" band for a bucket-averaged series. */
export interface ExpectedBand {
  from: number;
  to: number;
  /** Half-width of the band (3σ/√n̄), for the "±" chip. */
  spread: number;
  /** The baseline mean, for the chip label. */
  mean: number;
}

/**
 * Derive the expected band for a chart that plots per-bucket AVERAGES: the
 * standard deviation of a bucket mean is σ/√n, so the band is scaled by the
 * average runs-per-bucket to stay visually honest against the plotted series.
 */
export function deriveExpectedBand({
  baseline,
  buckets,
}: {
  baseline: AnomalyBaselineDto | undefined;
  buckets: ReadonlyArray<{ runCount: number }>;
}): ExpectedBand | undefined {
  if (baseline === undefined) return undefined;
  let totalRuns = 0;
  for (const bucket of buckets) totalRuns += bucket.runCount || 1;
  const avgRunCount = Math.max(1, totalRuns / Math.max(1, buckets.length));
  const spread = (baseline.stdDev / Math.sqrt(avgRunCount)) * 3;
  return {
    from: Math.max(0, baseline.mean - spread),
    to: baseline.mean + spread,
    spread,
    mean: baseline.mean,
  };
}

/** The projected drift over the baseline window. */
export interface TrendInfo {
  /** `trendSlope × sampleCount` — the same scalar the drift evaluator uses. */
  projectedChange: number;
  /** True when the projection exceeds 2σ. */
  isDrifting: boolean;
}

/**
 * Derive the trend chip. Returns undefined when there is no baseline or the
 * projected change is negligible (≤ 0.01), matching the prior inline logic.
 */
export function deriveTrend({
  baseline,
}: {
  baseline: AnomalyBaselineDto | undefined;
}): TrendInfo | undefined {
  if (baseline === undefined) return undefined;
  const projectedChange = baseline.trendSlope * baseline.sampleCount;
  if (Math.abs(projectedChange) <= 0.01) return undefined;
  const driftSigmas =
    baseline.stdDev > 0 ? Math.abs(projectedChange) / baseline.stdDev : 0;
  return { projectedChange, isDrifting: driftSigmas >= 2 };
}

/** Preformatted header chips for a chart card. */
export interface BaselineChips {
  /** e.g. `Expected: 120ms (±18)` */
  expected?: string;
  trend?: {
    /** e.g. `Trend: ↑ +12ms` */
    text: string;
    drifting: boolean;
  };
}

/**
 * Format the Expected/Trend chips shown next to a chart with a numeric
 * baseline. `decimals` matches the metric's display precision (0 for latency
 * milliseconds, 1 for generic metrics).
 */
export function formatBaselineChips({
  band,
  trend,
  unit = "",
  decimals = 0,
}: {
  band: ExpectedBand | undefined;
  trend: TrendInfo | undefined;
  unit?: string;
  decimals?: number;
}): BaselineChips {
  const chips: BaselineChips = {};
  if (band !== undefined) {
    chips.expected = `Expected: ${band.mean.toFixed(decimals)}${unit} (±${band.spread.toFixed(decimals)})`;
  }
  if (trend !== undefined) {
    const arrow = trend.projectedChange >= 0 ? "↑ +" : "↓ ";
    chips.trend = {
      text: `Trend: ${arrow}${trend.projectedChange.toFixed(decimals)}${unit}`,
      drifting: trend.isDrifting,
    };
  }
  return chips;
}

/** Whether a baseline is dominance-typed (categorical, no meaningful μ/σ). */
export function isDominanceBaseline({
  baseline,
}: {
  baseline: AnomalyBaselineDto | undefined;
}): boolean {
  return (
    baseline !== undefined &&
    baseline.dominantValue !== undefined &&
    baseline.dominantValue !== null
  );
}

/** How a boolean dominant's `"true"` / `"false"` render in a chip. */
export interface BooleanDominantLabels {
  true: string;
  false: string;
}

/**
 * Human labels for a boolean dominant, derived from the raw field the
 * baseline was learned on (the last segment of its `fieldPath`): `success`
 * reads `success` / `not success`, `isValid` reads `is valid` /
 * `not is valid`. Keeps the raw storage values `true`/`false` out of the UI.
 */
export function booleanDominantLabels({
  fieldPath,
}: {
  fieldPath: string;
}): BooleanDominantLabels {
  const rawField = fieldPath.split(".").at(-1) ?? fieldPath;
  const humanized = rawField
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
  return { true: humanized, false: `not ${humanized}` };
}

/**
 * Format the chip for a categorical/boolean DOMINANCE baseline, e.g.
 * `Usually success (98%)` or `Usually primary (98%)`. The chip names the
 * dominant VALUE plus its historical share - a bare percentage would beg
 * "98% of what?", and mean/sigma bands do not exist for dominance baselines
 * (their mean/stdDev are 0). Worded as a description of history ("Usually"),
 * not a demand ("Expected"): the anomaly engine alerts on dominance FLIPS,
 * not on deviations from this number. A missing ratio drops the share rather
 * than fabricating one.
 *
 * `booleanLabels` humanizes boolean dominants so the raw `true`/`false`
 * never reach the UI - callers pick language matching their surface (the
 * field name for a rate gauge, Yes/No for a boolean tile).
 */
export function formatDominantChip({
  baseline,
  booleanLabels,
}: {
  baseline: AnomalyBaselineDto | undefined;
  booleanLabels?: BooleanDominantLabels;
}): string | undefined {
  if (
    baseline === undefined ||
    baseline.dominantValue === undefined ||
    baseline.dominantValue === null
  ) {
    return undefined;
  }
  let value = String(baseline.dominantValue);
  if (booleanLabels !== undefined && (value === "true" || value === "false")) {
    value = value === "true" ? booleanLabels.true : booleanLabels.false;
  }
  const ratio = baseline.dominantRatio
    ? ` (${(baseline.dominantRatio * 100).toFixed(0)}%)`
    : "";
  return `Usually ${value}${ratio}`;
}
