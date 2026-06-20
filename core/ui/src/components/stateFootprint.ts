/**
 * Shared footprint tokens for the loading / empty / error state primitives.
 *
 * The three states a data surface can be in (skeleton, empty, error) must
 * occupy the SAME vertical space so swapping between them - and to the real
 * content - causes no layout shift. Every state primitive sizes its container
 * from this single source of truth.
 *
 * - `inline` : a compact strip (e.g. an inline error/empty inside a row group).
 * - `panel`  : a card-sized surface (the default for list/detail panels).
 * - `chart`  : matches the `chart` Skeleton variant, for chart surfaces.
 */
export type StateFootprint = "inline" | "panel" | "chart";

export const STATE_FOOTPRINT_CLASS: Record<StateFootprint, string> = {
  inline: "min-h-[5rem]",
  panel: "min-h-48",
  chart: "min-h-48",
};

export const DEFAULT_STATE_FOOTPRINT: StateFootprint = "panel";

/**
 * Resolves the min-height class for a given footprint. Pure + total so it can
 * be unit-tested and called during render.
 */
export const stateFootprintClass = (
  footprint: StateFootprint = DEFAULT_STATE_FOOTPRINT,
): string => STATE_FOOTPRINT_CLASS[footprint];
