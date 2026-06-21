/**
 * Shared presentation tokens for the command palette surface.
 *
 * Centralising these class strings keeps every kbd chip, the dialog shell, and
 * the navbar trigger visually in lock-step so the premium look can never drift
 * between the trigger and the palette it opens.
 */

/** Unified keyboard-chip styling used by result rows and the footer hints. */
export const PALETTE_KBD_CHIP =
  "inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-surface-inset border border-border/70 font-mono text-[10px] text-muted-foreground";

/** Layered depth shadow for the dialog shell (soft hairline + deep lift). */
export const PALETTE_SHELL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_24px_60px_-20px_hsl(var(--foreground)/0.35)]";

/** Soft layered shadow for the resting navbar trigger. */
export const PALETTE_TRIGGER_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_8px_20px_-12px_hsl(var(--foreground)/0.18)]";
