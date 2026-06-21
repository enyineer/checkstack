/**
 * Shared visual treatment for the inline tool cards (ConfirmCardView,
 * AppliedCardView). Both cards share the same premium container chrome so the
 * proposed/applied pair reads as a matched set, differentiated only by the
 * status tone driving the left accent stripe and the status pill.
 *
 * Tone is the colorblind-safe status triad (ok/warn/down). Class strings are
 * spelled out literally (never interpolated) so Tailwind's JIT keeps them.
 */
export type ToolCardTone = "ok" | "warn" | "down";

/** Per-tone pill, dot, and left-accent-stripe classes for the status triad. */
export const toolCardToneStyles: Record<
  ToolCardTone,
  { pill: string; dot: string; accent: string; icon: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    icon: "text-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    icon: "text-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    icon: "text-status-down",
  },
};

/**
 * The shared card shell: gradient surface, layered shadow, soft border, density
 * padding, and a relative/overflow-hidden context for the left accent stripe.
 */
export const toolCardShell =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 " +
  "bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] " +
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

/** Recessed inset look for the diff / JSON preview blocks. */
export const toolCardInset =
  "rounded-md border border-border/60 bg-surface-inset";

/** The status pill: a filled dot + label, multi-encoding status beyond hue. */
export const toolCardPill =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
