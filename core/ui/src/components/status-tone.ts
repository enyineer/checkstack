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
 *   are neither good, bad, nor unknown (e.g. a scheduled maintenance window).
 *
 * ## At most ONE coloured dimension per row
 *
 * A record often carries two: an URGENCY (severity, impact - "how bad is
 * this") and a LIFECYCLE (status, state - "where is it in its process").
 * Colouring both puts two competing scales on one line, where a red
 * "Investigating" beside an amber "Major" reads as a contradiction rather than
 * as two independent facts. So:
 *
 * - A domain with BOTH gives hue to the urgency - the pill, the row's leading
 *   dot, the card's accent stripe - and states the lifecycle in words on a
 *   NEUTRAL pill (`bg-muted text-muted-foreground`, no dot: with no hue to
 *   encode, a grey dot adds nothing). Incidents and announcements are both this
 *   shape, and the public status page has always rendered incidents this way.
 * - A domain with only ONE dimension gives it the hue. Maintenance has no
 *   severity, so its lifecycle is coloured and drives the row accent - nothing
 *   competes with it. The same goes for health checks, SLOs and gitops syncs.
 *
 * The AGGREGATE view is the exception: a stat card that IS a lifecycle bucket
 * (the announcements strip) is coloured by lifecycle, because there is no
 * urgency on a count to compete with.
 */
export type StatusPillTone = "ok" | "warn" | "down" | "unknown" | "info";

/**
 * The NEUTRAL treatment: the deliberate absence of a tone, for a state read
 * from its label alone.
 *
 * Not a member of {@link pillToneStyles} because it is not a tone - it is what
 * you use when the row already spends its colour on a more important dimension
 * (see the "at most one coloured dimension per row" rule above), or when a value
 * genuinely carries no good/bad/informational signal.
 *
 * Exported because three plugins had each written these same three strings out
 * by hand. `StatusPill`'s `tone="neutral"` renders the `pill` half of it.
 */
export const neutralToneStyle = {
  pill: "bg-muted text-muted-foreground",
  dot: "bg-muted-foreground",
  accent: "bg-border",
} as const;

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
