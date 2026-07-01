import { isAccessRuleSatisfied, type AccessRule } from "@checkstack/common";
import type { ManageCapability } from "@checkstack/frontend-api";

/**
 * The nav-entry fields the sidebar filtering/grouping reads. Kept structural so
 * this logic is pure and unit-testable without the registry or React.
 */
export interface NavLike {
  group: string;
  label: string;
  order: number;
  /** Static access rule gating visibility (effective rule from the registry). */
  accessRule?: AccessRule;
  /**
   * Team-capability gate (effective from the registry). When present, the entry
   * is shown if `accessRule` is satisfied OR the user can create/manage the
   * declared type (or its parent) via a team - i.e. its `objectType`/`parentType`
   * appears in `manageableTypes`.
   */
  manageCapability?: ManageCapability;
  /** Dynamic predicate; both this AND `accessRule` must pass to show the entry. */
  isVisible?: (context: {
    accessRules: string[];
    isAuthenticated: boolean;
  }) => boolean;
}

/** One rendered sidebar section: a group label and its visible entries. */
export interface NavGroupOf<R> {
  group: string;
  items: R[];
  /**
   * True when the group has exactly one visible entry. The sidebar renders
   * these as flat top-level items (no group header) to cut visual chrome for
   * single-item sections (e.g. Automation).
   */
  flat: boolean;
}

/**
 * Filter routes to the ones the current user may see, group them by section, and
 * order both groups and items. A route is visible when:
 *  - it declares `nav`, AND
 *  - its `accessRule` (if any) is satisfied by the user's access rules, AND
 *  - its `isVisible` predicate (if any) returns true.
 *
 * Crucially, groups are built ONLY from visible routes, so a section whose every
 * entry is filtered out is not returned at all - e.g. the Infrastructure entry
 * disappears for a user who can read none of its tabs. Pure: no registry, no
 * hooks, no DOM.
 */
export function selectNavGroups<R extends { nav?: NavLike }>({
  routes,
  accessRules,
  isAuthenticated,
  groupOrder,
  manageableTypes = new Set<string>(),
}: {
  routes: R[];
  accessRules: string[];
  isAuthenticated: boolean;
  groupOrder: readonly string[];
  /**
   * Resource types the user can create/manage-any of via a team grant. Lets an
   * entry with a `manageCapability` show for a team-scoped user who holds no
   * global rule. Empty set (the default) reduces to pure global-rule gating.
   */
  manageableTypes?: Set<string>;
}): Array<NavGroupOf<R & { nav: NavLike }>> {
  const visible = routes.filter((route): route is R & { nav: NavLike } => {
    const nav = route.nav;
    if (nav === undefined) return false;
    const globalOk =
      nav.accessRule === undefined ||
      isAccessRuleSatisfied(accessRules, nav.accessRule);
    // Team-capability fallback: managing the type (or its parent) unlocks the
    // entry even without the global rule.
    const cap = nav.manageCapability;
    const capOk =
      cap !== undefined &&
      (manageableTypes.has(cap.objectType) ||
        (cap.parentType !== undefined && manageableTypes.has(cap.parentType)));
    if (!globalOk && !capOk) {
      return false;
    }
    if (
      nav.isVisible !== undefined &&
      !nav.isVisible({ accessRules, isAuthenticated })
    ) {
      return false;
    }
    return true;
  });

  const byGroup = new Map<string, Array<R & { nav: NavLike }>>();
  for (const route of visible) {
    const list = byGroup.get(route.nav.group);
    if (list) list.push(route);
    else byGroup.set(route.nav.group, [route]);
  }

  const orderOf = (group: string): number => {
    const index = groupOrder.indexOf(group);
    return index === -1 ? groupOrder.length : index;
  };

  return [...byGroup.entries()]
    .toSorted(([a], [b]) => orderOf(a) - orderOf(b) || a.localeCompare(b))
    .map(([group, items]) => {
      const sorted = items.toSorted(
        (a, b) =>
          a.nav.order - b.nav.order || a.nav.label.localeCompare(b.nav.label),
      );
      return { group, items: sorted, flat: sorted.length === 1 };
    });
}
