import type { SubscriptionInheritance } from "@checkstack/notification-common";
import type { ResolvedInheritance } from "./SubscriptionRow";

/**
 * Pure helpers that fold the backend's structural inheritance map
 * (`resolveSubscriptionInheritance`) into the props the generic
 * `<SubscriptionRow>` already accepts. Kept DB- and React-free so the
 * group-vs-system / inherited-state wiring is unit-testable in isolation.
 */

/**
 * Every group id whose subscription status the bell must fetch: the
 * primary (resource-level) group ids UNION every inherited (parent) group
 * id. Deduplicated, order-stable (primaries first). Feeding this combined
 * set to `getMySubscriptionStatus` means one batch call answers both the
 * per-row "am I subscribed?" and the inherited "is the parent subscribed?"
 * questions.
 */
export function collectStatusGroupIds({
  primaryGroupIds,
  inheritance,
}: {
  primaryGroupIds: readonly string[];
  inheritance: SubscriptionInheritance;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of primaryGroupIds) add(id);
  for (const entry of inheritance) {
    for (const inh of entry.inheritance) add(inh.groupId);
  }
  return out;
}

/**
 * Build the `inheritance` + `inheritanceStatus` props for a single spec's
 * row: each inherited parent group enriched with the caller's subscribed
 * flag from the status batch. Returns empty structures when the spec has no
 * parents (e.g. a group bell, whose target has no parent target).
 */
export function buildRowInheritance({
  specId,
  inheritance,
  statusMap,
}: {
  specId: string;
  inheritance: SubscriptionInheritance;
  statusMap: Record<string, boolean>;
}): {
  inheritance: ResolvedInheritance[];
  inheritanceStatus: Record<string, boolean>;
} {
  const entry = inheritance.find((e) => e.specId === specId);
  if (!entry || entry.inheritance.length === 0) {
    return { inheritance: [], inheritanceStatus: {} };
  }
  const rows: ResolvedInheritance[] = entry.inheritance.map((inh) => ({
    groupId: inh.groupId,
    label: inh.label,
    subscribed: statusMap[inh.groupId] ?? false,
  }));
  const inheritanceStatus: Record<string, boolean> = {};
  for (const row of rows) inheritanceStatus[row.groupId] = row.subscribed;
  return { inheritance: rows, inheritanceStatus };
}
