/**
 * Per-tone class sets for the status pill, dot, and a card/row's left accent
 * stripe, driven by the colorblind-safe status triad. The classes come from the
 * shared `pillToneStyles` table rather than a private copy, so the GitOps
 * provider, secret, and provenance surfaces stay in step with the rest of the
 * design system.
 */

import { pillToneStyles } from "@checkstack/ui";

export type GitOpsTone = "ok" | "warn" | "down" | "unknown";

export interface ToneStyle {
  pill: string;
  dot: string;
  accent: string;
  text: string;
}

export const toneStyles: Record<GitOpsTone, ToneStyle> = {
  ok: pillToneStyles.ok,
  warn: pillToneStyles.warn,
  down: pillToneStyles.down,
  unknown: pillToneStyles.unknown,
};

/**
 * The shared card/row depth recipe (gradient + layered shadow + rounded border).
 * Hover lift is applied separately by surfaces that link/interact so static
 * panels can opt out.
 */
export const cardSurface =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";
