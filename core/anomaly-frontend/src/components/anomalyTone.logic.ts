/**
 * Maps anomaly states to the colorblind-safe status triad used across the
 * design system. Confirmed anomalies read as `warn`; suspicious (not yet
 * confirmed) ones read as `unknown`. The classes come from the shared
 * `pillToneStyles` table rather than a private copy, so this surface cannot
 * drift from the rest of the design system.
 */

import { pillToneStyles } from "@checkstack/ui";

export type AnomalyTone = "warn" | "unknown";

export interface AnomalyToneStyles {
  pill: string;
  dot: string;
  accent: string;
  text: string;
}

const TONE_STYLES: Record<AnomalyTone, AnomalyToneStyles> = {
  warn: pillToneStyles.warn,
  unknown: pillToneStyles.unknown,
};

/** The tone for a single anomaly state string. */
export function toneForState(state: string): AnomalyTone {
  return state === "suspicious" ? "unknown" : "warn";
}

/** Resolve the full class-set for a tone. */
export function anomalyToneStyles(tone: AnomalyTone): AnomalyToneStyles {
  return TONE_STYLES[tone];
}

/**
 * The accent stripe / overall card tone for the widget: `warn` when any
 * confirmed anomaly is present, otherwise `unknown` (only suspicious rows).
 */
export function widgetTone({
  confirmedCount,
}: {
  confirmedCount: number;
}): AnomalyTone {
  return confirmedCount > 0 ? "warn" : "unknown";
}
