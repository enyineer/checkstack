import type { Automation } from "@checkstack/automation-common";

/**
 * Label for the implicit bucket holding automations with no `group`.
 * Always sorted LAST so it sits at the bottom of the list.
 */
export const UNGROUPED_LABEL = "Ungrouped";

export interface AutomationGroup {
  /** Display label (the group value, or {@link UNGROUPED_LABEL}). */
  label: string;
  /** Stable key for React + accordion state (the label is unique already). */
  key: string;
  /** Whether this is the implicit ungrouped bucket. */
  ungrouped: boolean;
  items: Automation[];
}

/**
 * Partition a flat automation list into named groups for the collapsible
 * list view. Pure so it is unit-testable without a DOM render.
 *
 * - Automations with a non-empty `group` land in that group.
 * - Automations with an absent / blank `group` land in {@link UNGROUPED_LABEL}.
 * - Named groups are sorted alphabetically (case-insensitive, locale-aware);
 *   the ungrouped bucket is always appended LAST.
 * - Item order within a group is preserved from the input.
 * - Empty groups are never produced.
 */
export function groupAutomations({
  automations,
}: {
  automations: Automation[];
}): AutomationGroup[] {
  const named = new Map<string, Automation[]>();
  const ungrouped: Automation[] = [];

  for (const automation of automations) {
    const group = automation.group?.trim();
    if (group) {
      const bucket = named.get(group);
      if (bucket) bucket.push(automation);
      else named.set(group, [automation]);
    } else {
      ungrouped.push(automation);
    }
  }

  const groups: AutomationGroup[] = [...named.entries()]
    .toSorted(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    )
    .map(([label, items]) => ({ label, key: label, ungrouped: false, items }));

  if (ungrouped.length > 0) {
    groups.push({
      label: UNGROUPED_LABEL,
      key: UNGROUPED_LABEL,
      ungrouped: true,
      items: ungrouped,
    });
  }

  return groups;
}
