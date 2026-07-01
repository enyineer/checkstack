/**
 * Pure, DOM-free logic for the per-assignment environment selector. Kept
 * separate from the React component so it can be unit-tested in the repo-root
 * `bun test` run (which has no happy-dom).
 *
 * The selector has three modes that map to the `environmentIds` wire value
 * (semantics locked in the environments plan, §2/§7.1):
 * - "all"      => `null`  : run for ALL environments the system belongs to.
 * - "specific" => `string[]` (non-empty): run for exactly those env ids.
 * - "none"     => `[]`    : opt out, run ONCE with no environment.
 */
export type EnvironmentSelectorMode = "all" | "specific" | "none";

/**
 * Derive the UI mode from the stored `environmentIds` wire value.
 * `null`/`undefined` = all; `[]` = none; non-empty = specific.
 */
export function modeFromEnvironmentIds(
  environmentIds: string[] | null | undefined,
): EnvironmentSelectorMode {
  if (environmentIds === null || environmentIds === undefined) return "all";
  if (environmentIds.length === 0) return "none";
  return "specific";
}

/**
 * Compute the `environmentIds` wire value to persist for a chosen mode.
 *
 * For "specific", `selectedIds` is used verbatim (empty selection under
 * "specific" is NOT auto-coerced to "none" here — the component keeps the
 * mode explicit and `selectedIds` empty; callers/UI should require at least
 * one selection before this is treated as a meaningful "specific" set).
 */
export function environmentIdsForMode({
  mode,
  selectedIds,
}: {
  mode: EnvironmentSelectorMode;
  selectedIds: string[];
}): string[] | null {
  switch (mode) {
    case "all": {
      return null;
    }
    case "none": {
      return [];
    }
    case "specific": {
      return selectedIds;
    }
  }
}

/**
 * What the Environments subsection of the execution panel should render.
 * - "empty"    : the system belongs to no environment; show an empty-state
 *                instead of the (meaningless) mode selector.
 * - "selector" : show the All/Specific/None mode selector, pre-derived to the
 *                `mode` matching the stored `environmentIds` wire value.
 */
export type EnvironmentSectionView =
  | { kind: "empty" }
  | { kind: "selector"; mode: EnvironmentSelectorMode };

/**
 * Decide how the Environments subsection renders for the current system.
 *
 * When the system has zero environments the All/Specific/None modes are
 * meaningless (only "run once with no environment" applies), so the selector
 * collapses to an empty-state. Otherwise the stored `environmentIds` wire value
 * drives the active mode.
 *
 * The empty-state only appears once the environments query has actually
 * resolved (`settled`): while it is still loading, or if it errored, the
 * selector stays visible. The All/Specific/None mode is derived from the stored
 * `environmentIds`, not from the fetched list, so collapsing to the empty-state
 * on a transient or failed fetch would wrongly hide the control (and its stored
 * fan-out mode) instead of reflecting a genuinely env-less system.
 */
export function environmentSectionView({
  environments,
  environmentIds,
  settled,
}: {
  environments: { id: string }[];
  environmentIds: string[] | null | undefined;
  settled: boolean;
}): EnvironmentSectionView {
  if (settled && environments.length === 0) return { kind: "empty" };
  return { kind: "selector", mode: modeFromEnvironmentIds(environmentIds) };
}

/**
 * Toggle one environment id in a "specific" selection, returning the new
 * sorted-stable list (membership order is the caller's concern; this just
 * adds/removes preserving existing order).
 */
export function toggleEnvironmentId({
  selectedIds,
  environmentId,
}: {
  selectedIds: string[];
  environmentId: string;
}): string[] {
  return selectedIds.includes(environmentId)
    ? selectedIds.filter((id) => id !== environmentId)
    : [...selectedIds, environmentId];
}
