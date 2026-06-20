import type { SystemSignalTone } from "@checkstack/catalog-common";

/**
 * Per-tone class sets for the premium ProblemSystemCard surface: the status
 * pill, its inner dot, the card's left accent stripe, and the soft top glow.
 * Spelled out as full literal strings (not interpolated) so Tailwind's JIT
 * keeps them. Driven by the signal tone, mapped onto the colorblind-safe
 * status triad (error -> down, warn -> warn, info -> info/watch) so status is
 * encoded by hue AND position AND label, never color alone.
 */
export interface ProblemToneStyle {
  /** Status pill background + text. */
  pill: string;
  /** Inner dot inside the pill (and any standalone marker). */
  dot: string;
  /** Card left accent stripe background. */
  accent: string;
  /** Soft top-edge glow (gradient `from-*`), only rendered on capable devices. */
  glow: string;
  /** Human label for the pill, matching the header chip vocabulary. */
  label: string;
}

export const problemToneStyles: Record<SystemSignalTone, ProblemToneStyle> = {
  error: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    glow: "from-status-down/[0.08]",
    label: "Critical",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    glow: "from-status-warn/[0.08]",
    label: "Degraded",
  },
  info: {
    pill: "bg-info/10 text-info",
    dot: "bg-info",
    accent: "bg-info",
    glow: "from-info/[0.07]",
    label: "Watch",
  },
};

/** Pick the tone style set for a system's worst tone. */
export function resolveProblemToneStyle(
  tone: SystemSignalTone,
): ProblemToneStyle {
  return problemToneStyles[tone];
}

/** Pluralized caption for a signal count (e.g. "1 signal" vs "3 signals"). */
export function signalCountCaption(count: number): string {
  return count === 1 ? "signal" : "signals";
}
