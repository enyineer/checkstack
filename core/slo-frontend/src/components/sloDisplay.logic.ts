/**
 * Pure, DOM-free display helpers for the SLO dashboard components.
 *
 * These derive the visual classification (color tier, formatted text) shown by
 * the burn-rate, error-budget, streak, and downtime widgets. They are kept here
 * so the branch logic can be unit-tested without rendering React or importing
 * `@checkstack/ui`.
 */

/** Qualitative classification of a burn rate relative to the SLO window. */
export type BurnRateTier = "good" | "warn" | "bad" | "unknown";

/**
 * Classify a burn rate. A rate below 1 consumes budget slower than the window
 * allows (`"good"`); above 1.5 it is consuming dangerously fast (`"bad"`);
 * anything in between is on-pace (`"warn"`). A null/undefined rate is
 * `"unknown"` (no data).
 */
export function classifyBurnRate({
  burnRate,
}: {
  burnRate: number | null | undefined;
}): BurnRateTier {
  if (burnRate === null || burnRate === undefined) return "unknown";
  if (burnRate < 1) return "good";
  if (burnRate > 1.5) return "bad";
  return "warn";
}

/** Color tier for the error-budget bar, by consumption vs. thresholds. */
export type BudgetTier = "ok" | "warning" | "critical";

/**
 * Resolve the error-budget consumption tier. Thresholds are checked
 * critical-first so an exact threshold hit lands in the more severe tier.
 */
export function classifyBudgetConsumption({
  consumedPercent,
  warningThreshold,
  criticalThreshold,
}: {
  consumedPercent: number;
  warningThreshold: number;
  criticalThreshold: number;
}): BudgetTier {
  if (consumedPercent >= criticalThreshold) return "critical";
  if (consumedPercent >= warningThreshold) return "warning";
  return "ok";
}

/**
 * Remaining budget percentage, clamped to the `[0, 100]` range so an
 * over-consumed budget reports `0` rather than a negative number.
 */
export function remainingBudgetPercent({
  consumedPercent,
}: {
  consumedPercent: number;
}): number {
  return Math.max(0, 100 - consumedPercent);
}

/** Width of the consumed portion of the bar, clamped to a maximum of 100. */
export function consumedBarWidthPercent({
  consumedPercent,
}: {
  consumedPercent: number;
}): number {
  return Math.min(consumedPercent, 100);
}

/**
 * Overall SLO health tier shown on the objective card. Checked most-severe
 * first: an actively breaching objective always reads `"breaching"`, an open
 * downtime `"degraded"`, a budget at/under 20% remaining `"at-risk"`, and
 * everything else `"healthy"`.
 */
export type SloStatusTier = "breaching" | "degraded" | "at-risk" | "healthy";

/** Threshold (in % budget remaining) below which a healthy SLO reads "at risk". */
export const AT_RISK_BUDGET_REMAINING_PERCENT = 20;

export function classifySloStatus({
  isBreaching,
  hasOpenDowntime,
  errorBudgetRemainingPercent,
}: {
  isBreaching: boolean;
  hasOpenDowntime: boolean;
  errorBudgetRemainingPercent: number;
}): SloStatusTier {
  if (isBreaching) return "breaching";
  if (hasOpenDowntime) return "degraded";
  if (errorBudgetRemainingPercent <= AT_RISK_BUDGET_REMAINING_PERCENT)
    return "at-risk";
  return "healthy";
}

/** The colorblind-safe status-triad stem a tier maps onto. */
export type StatusTone = "ok" | "warn" | "down";

export interface SloStatusPresentation {
  label: string;
  tone: StatusTone;
}

/** Map an {@link SloStatusTier} to its human label + status-triad tone. */
export function presentSloStatus({
  tier,
}: {
  tier: SloStatusTier;
}): SloStatusPresentation {
  switch (tier) {
    case "breaching": {
      return { label: "Breaching", tone: "down" };
    }
    case "degraded": {
      return { label: "Degraded", tone: "warn" };
    }
    case "at-risk": {
      return { label: "At risk", tone: "warn" };
    }
    default: {
      return { label: "Healthy", tone: "ok" };
    }
  }
}

/** Streak heat tier, escalating at the 7 / 30 / 90 consecutive-day marks. */
export type StreakTier = "cold" | "warm" | "hot" | "blazing";

/**
 * Classify a compliance streak into a heat tier. Boundaries are inclusive:
 * 7 days is `"warm"`, 30 is `"hot"`, 90 is `"blazing"`.
 */
export function classifyStreak({
  currentStreak,
}: {
  currentStreak: number;
}): StreakTier {
  if (currentStreak >= 90) return "blazing";
  if (currentStreak >= 30) return "hot";
  if (currentStreak >= 7) return "warm";
  return "cold";
}

/**
 * Format a downtime duration (in seconds) as a compact human string. Under an
 * hour it reads as `"<n> min"`; an hour or more reads as `"<h>h <m>m"`. A
 * missing or zero duration yields `undefined` (ongoing/unknown or no measurable
 * downtime), so the timeline shows no duration chip for it.
 */
export function formatDowntimeDuration({
  durationSeconds,
}: {
  durationSeconds: number | null | undefined;
}): string | undefined {
  if (!durationSeconds) return;
  const minutes = Math.round(durationSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
