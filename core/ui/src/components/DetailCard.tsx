import * as React from "react";
import { cn } from "../utils";

/**
 * The canonical elevated surface for cards on the system detail / overview page
 * and the plugin cards contributed into its extension slots (Logs / Metrics /
 * Traces, health, dependency, SLO, incident, anomaly, maintenance).
 *
 * This chrome was hand-rolled as a copy-pasted className (and a per-file
 * `PANEL_SHADOW` constant) in every one of those cards, and it drifted: the
 * telemetry `LinkedStreamsCard` regressed to a flat `bg-card` with a
 * hairline-only shadow, so the Logs/Metrics/Traces cards rendered visibly
 * flatter than their siblings on the same page. Extracting the surface here
 * makes that class of drift impossible - every card renders identical chrome -
 * and gives the `checkstack/no-inline-detail-card-chrome` ESLint rule a single
 * sanctioned home to point authors at.
 *
 * `detailCardSurface` uses the detail-page radius token (`--d-card-r`), a
 * subtle vertical gradient (`from-surface-2 to-surface`), and the two-layer
 * elevation shadow (hairline + soft drop). It carries its OWN opaque
 * background because the detail page paints a grid backdrop that a transparent
 * box would let bleed through (see the "opaque surfaces" code-style rule).
 */
export const detailCardSurface =
  "rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

/**
 * Flat companion surface for the compact loading / placeholder states of the
 * same cards: same radius and border, a solid `bg-surface`, and no elevation
 * shadow (a spinner strip should not read as a raised card).
 */
export const detailCardSurfaceFlat =
  "rounded-[var(--d-card-r)] border border-border/70 bg-surface";

export interface DetailCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `elevated` (default) renders the gradient + two-layer elevation shadow used
   * by every real system-overview card. `flat` renders the solid `bg-surface`
   * placeholder chrome for compact loading / empty strips.
   */
  surface?: "elevated" | "flat";
}

/**
 * Drop-in container for a system-overview detail card. Prefer this over
 * hand-rolling the `detailCardSurface` className so the surface stays
 * single-sourced. Extra layout (padding, `overflow-hidden`, a status-tinted
 * `border-*` override, `relative`, transitions) is passed via `className` and
 * merged with `twMerge`, so overrides win as expected.
 */
export const DetailCard = ({
  surface = "elevated",
  className,
  ...props
}: DetailCardProps) => (
  <div
    className={cn(
      surface === "flat" ? detailCardSurfaceFlat : detailCardSurface,
      className,
    )}
    {...props}
  />
);
