/**
 * Maps anomaly states to the colorblind-safe status triad used across the
 * design system. Confirmed anomalies read as `warn`; suspicious (not yet
 * confirmed) ones read as `unknown`. Spelled out as full literal class strings
 * (not interpolated) so Tailwind's JIT keeps them.
 */
export type AnomalyTone = "warn" | "unknown";

export interface AnomalyToneStyles {
  pill: string;
  dot: string;
  accent: string;
  text: string;
}

const TONE_STYLES: Record<AnomalyTone, AnomalyToneStyles> = {
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    text: "text-status-warn",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    text: "text-status-unknown",
  },
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
