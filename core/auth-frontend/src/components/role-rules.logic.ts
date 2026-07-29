import type { AccessRuleEntry } from "../api";

/**
 * One plugin's access rules, ready to render as an accordion category.
 *
 * `label` is the HUMAN-READABLE category name (the plugin id with hyphens
 * turned into spaces). Categories sort on it rather than on the raw plugin id
 * so the order matches what the reader actually sees.
 */
export interface AccessRuleCategory {
  /** The plugin id the rules belong to (the accordion item's stable value). */
  pluginId: string;
  /** Display name shown in the accordion header. */
  label: string;
  rules: AccessRuleEntry[];
}

/**
 * Group access rules by their owning plugin and sort BOTH levels
 * alphabetically.
 *
 * Rules arrive in plugin-REGISTRATION order, which is effectively arbitrary to
 * a reader looking for "Satellite" or "Dependency" in a long list. Sorting is
 * by the rendered label (and, within a category, by rule id) using
 * `localeCompare` so the order matches the reading order rather than raw
 * code-point order.
 */
export function groupAccessRulesByCategory({
  rules,
}: {
  rules: readonly AccessRuleEntry[];
}): AccessRuleCategory[] {
  const byPlugin = new Map<string, AccessRuleEntry[]>();

  for (const rule of rules) {
    const [pluginId = rule.id] = rule.id.split(".");
    const existing = byPlugin.get(pluginId);
    if (existing) {
      existing.push(rule);
    } else {
      byPlugin.set(pluginId, [rule]);
    }
  }

  return [...byPlugin.entries()]
    .map(([pluginId, pluginRules]) => ({
      pluginId,
      label: toCategoryLabel({ pluginId }),
      rules: pluginRules.toSorted((a, b) => a.id.localeCompare(b.id)),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

/** The accordion header text for a plugin id (`auth-github` -> `auth github`). */
export function toCategoryLabel({ pluginId }: { pluginId: string }): string {
  return pluginId.replaceAll("-", " ");
}

/**
 * How much of a category is currently selected. Drives which bulk action the
 * header offers ("Select all" until everything selectable is on, then "Clear").
 */
export type CategorySelectionState = "none" | "some" | "all";

export function getCategorySelectionState({
  selected,
  selectableIds,
}: {
  selected: ReadonlySet<string>;
  selectableIds: readonly string[];
}): CategorySelectionState {
  if (selectableIds.length === 0) return "none";
  const count = selectableIds.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === selectableIds.length ? "all" : "some";
}

/**
 * Select or clear a whole category, returning a NEW set.
 *
 * `selectableIds` is the category's ids MINUS anything the caller has ruled out
 * (for the anonymous role, rules no public endpoint uses). Selecting therefore
 * can never add a blocked rule, mirroring the per-checkbox guard - the bulk
 * action must not be a way around a restriction the single toggle enforces.
 *
 * Clearing removes only the category's own ids, so a bulk clear never disturbs
 * a selection in another category. Ids already selected but no longer
 * selectable (e.g. a legacy grant) are left alone on select and removed on
 * clear, so the action is always a no-worse-off operation.
 */
export function setCategorySelection({
  selected,
  selectableIds,
  categoryIds,
  select,
}: {
  selected: ReadonlySet<string>;
  selectableIds: readonly string[];
  categoryIds: readonly string[];
  select: boolean;
}): Set<string> {
  const next = new Set(selected);

  if (select) {
    for (const id of selectableIds) next.add(id);
    return next;
  }

  for (const id of categoryIds) next.delete(id);
  return next;
}
