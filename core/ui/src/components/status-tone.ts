/**
 * Colorblind-safe status tones, shared across every plugin that presents a
 * status pill (incidents, maintenance, ...). Status is multi-encoded (hue + a
 * dot + a text label, plus a left accent stripe on cards/rows) so it never
 * reads by color alone.
 *
 * This module is intentionally DOM-free (no React import) so pure presentation
 * logic - e.g. an incident plugin's `badges.logic.ts` - can consume the tones
 * and their class sets without pulling React into its test process.
 *
 * Tones:
 * - `ok` / `warn` / `down` - the luminance-separated triad.
 * - `unknown` - a neutral grey for genuinely unknown / inert states.
 * - `info` - a fifth blue hue OUTSIDE the ok/warn/down ladder, for states that
 *   are neither good, bad, nor unknown (e.g. an incident being "monitored").
 */
export type StatusPillTone = "ok" | "warn" | "down" | "unknown" | "info";

/**
 * Per-tone class sets for the status pill, its leading dot, a left accent
 * stripe used by cards/rows, and the standalone foreground/tint/border classes
 * a banner or icon needs. Spelled out as full literal strings (never
 * interpolated) so Tailwind's JIT keeps `bg-status-*` / `text-status-*` /
 * `border-status-*`, and driven by the shared status tokens (see `themes.css`).
 *
 * Named `pillToneStyles` (not `toneStyles`) to avoid colliding with the
 * unrelated `StatusTone` already exported by `StatusBadge`.
 */
export const pillToneStyles: Record<
  StatusPillTone,
  {
    pill: string;
    dot: string;
    accent: string;
    text: string;
    tint: string;
    border: string;
    tintHover: string;
  }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    text: "text-status-ok",
    tint: "bg-status-ok/10",
    border: "border-status-ok/20",
    tintHover: "hover:bg-status-ok/20",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    text: "text-status-warn",
    tint: "bg-status-warn/10",
    border: "border-status-warn/20",
    tintHover: "hover:bg-status-warn/20",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    text: "text-status-down",
    tint: "bg-status-down/10",
    border: "border-status-down/20",
    tintHover: "hover:bg-status-down/20",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    text: "text-status-unknown",
    tint: "bg-status-unknown/10",
    border: "border-status-unknown/20",
    tintHover: "hover:bg-status-unknown/20",
  },
  info: {
    pill: "bg-status-info/10 text-status-info",
    dot: "bg-status-info",
    accent: "bg-status-info",
    text: "text-status-info",
    tint: "bg-status-info/10",
    border: "border-status-info/20",
    tintHover: "hover:bg-status-info/20",
  },
};
