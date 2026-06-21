/**
 * Per-tone class sets for the status pill, dot, and a card/row's left accent
 * stripe, driven by the colorblind-safe status triad. Spelled out as full
 * literal strings (not interpolated) so Tailwind's JIT keeps them. Shared
 * across the GitOps provider, secret, and provenance surfaces so the depth
 * recipe stays consistent.
 */

export type GitOpsTone = "ok" | "warn" | "down" | "unknown";

export interface ToneStyle {
  pill: string;
  dot: string;
  accent: string;
  text: string;
}

export const toneStyles: Record<GitOpsTone, ToneStyle> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    text: "text-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    text: "text-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    text: "text-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    text: "text-status-unknown",
  },
};

/**
 * The shared card/row depth recipe (gradient + layered shadow + rounded border).
 * Hover lift is applied separately by surfaces that link/interact so static
 * panels can opt out.
 */
export const cardSurface =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";
