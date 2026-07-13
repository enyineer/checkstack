/**
 * Pure mapping between the severity-rules editor's row-based form state and the
 * `SeverityRules` shape stored in a stream's config. Kept pure so the Settings
 * section stays a thin rendering layer and the round-trip (config -> rows ->
 * config) is unit-tested in isolation.
 *
 * `SeverityRules` is `{ valueMap?, patternOverrides? }`; both sub-keys are
 * OMITTED when empty. The whole object is `undefined` when there is nothing to
 * store - the caller sends `severityRules: {}` to CLEAR previously-saved rules
 * (the config merge replaces the key), so an empty edit reliably persists as
 * "no remapping".
 */

import type {
  SeverityBand,
  SeverityRules,
} from "@checkstack/logstream-common";

/** One row of the source-value -> band editor. `id` is a stable React key. */
export interface ValueMapRow {
  id: string;
  value: string;
  band: SeverityBand;
}

/** One row of the pattern -> band override editor. `id` is a stable React key. */
export interface PatternOverrideRow {
  id: string;
  patternId: string;
  band: SeverityBand;
}

export interface SeverityRulesFormState {
  valueMap: ValueMapRow[];
  patternOverrides: PatternOverrideRow[];
}

/**
 * Seed the editor rows from stored rules. Row ids are derived from the index so
 * the initial render is deterministic (the component mints fresh ids when the
 * operator ADDS a row). A record has no order guarantee, so `valueMap` rows are
 * emitted in `Object.entries` order - stable enough for an editor seeded once.
 */
export function severityRulesToForm(
  rules: SeverityRules | undefined,
): SeverityRulesFormState {
  const valueMap = Object.entries(rules?.valueMap ?? {}).map(
    ([value, band], index) => ({ id: `value-${index}`, value, band }),
  );
  const patternOverrides = (rules?.patternOverrides ?? []).map(
    (override, index) => ({
      id: `pattern-${index}`,
      patternId: override.patternId,
      band: override.band,
    }),
  );
  return { valueMap, patternOverrides };
}

/**
 * Fold the editor rows back into a `SeverityRules`, or `undefined` when nothing
 * is set. Blank rows (empty source value / no pattern chosen) are dropped;
 * duplicate keys resolve last-wins so a re-typed value never yields an ambiguous
 * config. A sub-key is omitted entirely when it has no surviving rows.
 */
export function formToSeverityRules(
  form: SeverityRulesFormState,
): SeverityRules | undefined {
  const valueMap: Record<string, SeverityBand> = {};
  for (const row of form.valueMap) {
    const value = row.value.trim();
    if (value.length === 0) continue;
    valueMap[value] = row.band;
  }

  const overrideByPattern = new Map<string, SeverityBand>();
  for (const row of form.patternOverrides) {
    const patternId = row.patternId.trim();
    if (patternId.length === 0) continue;
    overrideByPattern.set(patternId, row.band);
  }

  const hasValueMap = Object.keys(valueMap).length > 0;
  const hasOverrides = overrideByPattern.size > 0;
  if (!hasValueMap && !hasOverrides) return undefined;

  const rules: SeverityRules = {};
  if (hasValueMap) rules.valueMap = valueMap;
  if (hasOverrides) {
    rules.patternOverrides = Array.from(overrideByPattern, ([patternId, band]) => ({
      patternId,
      band,
    }));
  }
  return rules;
}
