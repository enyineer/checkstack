import { pillToneStyles } from "@checkstack/ui";
import type { SystemSignalTone } from "@checkstack/catalog-common";

/**
 * Per-tone class sets for the premium ProblemSystemCard surface: the status
 * pill, its inner dot, the card's left accent stripe, and the soft top glow.
 * Driven by the signal tone, mapped onto the colorblind-safe status triad
 * (error -> down, warn -> warn, info -> info/watch) so status is encoded by hue
 * AND position AND label, never color alone. The pill/dot/accent classes come
 * from the shared `pillToneStyles` table; the glow gradient and the label are
 * this card's own, so they stay local (full literal strings so Tailwind's JIT
 * keeps them).
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
    ...pillToneStyles.down,
    glow: "from-status-down/[0.08]",
    label: "Critical",
  },
  warn: {
    ...pillToneStyles.warn,
    glow: "from-status-warn/[0.08]",
    label: "Degraded",
  },
  // `info` here is the general-purpose `--info` accent, NOT the status ladder's
  // `--status-info` - they are different hues (see `themes.css`). The "Watch"
  // signal is an informational nudge on a dashboard card rather than a rung on
  // the ok/warn/down ladder, so it deliberately keeps its own row.
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
