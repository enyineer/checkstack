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
