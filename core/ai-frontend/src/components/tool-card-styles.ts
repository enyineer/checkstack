/**
 * Shared visual treatment for the inline tool cards (ConfirmCardView,
 * AppliedCardView). Both cards share the same premium container chrome so the
 * proposed/applied pair reads as a matched set, differentiated only by the
 * status tone driving the left accent stripe and the status pill.
 *
 * Tone is the colorblind-safe status triad (ok/warn/down).
 */
import { pillToneStyles } from "@checkstack/ui";

export type ToolCardTone = "ok" | "warn" | "down";

/**
 * Per-tone pill, dot, accent-stripe and leading-icon (`text`) classes, taken
 * from the shared `pillToneStyles` table rather than a private copy.
 */
export const toolCardToneStyles: Pick<typeof pillToneStyles, ToolCardTone> = {
  ok: pillToneStyles.ok,
  warn: pillToneStyles.warn,
  down: pillToneStyles.down,
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

/**
 * Chip shape matching the shared `StatusPill`, for the ONE chip that carries no
 * status tone: the terminal "Applied. / Declined." outcome, whose declined half
 * is a surface-inset chip outside the ok/warn/down ladder. Toned chips use
 * `StatusPill` itself.
 */
export const toolCardPill =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
