/**
 * Pure core of `useManageableResources`: given the caller's per-resource access
 * verdict, return the items a resource picker should OFFER. Kept framework-free
 * so it is unit-tested without a React renderer (the hook is a thin wrapper).
 *
 * The rule every RLAC picker follows: offer everything when the caller holds the
 * global rule; otherwise offer only the resources they can access - plus any ids
 * already selected, so an existing selection the caller can no longer manage is
 * still shown (and can be removed) rather than silently vanishing.
 */
export function selectManageable<T>({
  items,
  getId,
  allowAll,
  canAccess,
  keepIds,
}: {
  items: readonly T[];
  getId: (item: T) => string;
  /**
   * The caller may select ANY item, so the list is offered unfiltered. Typically
   * the per-resource global rule, but it can be a HIGHER rule that authorizes
   * targeting any instance (e.g. a global incident manager may reference any
   * system even without global system-manage).
   */
  allowAll: boolean;
  /** Per-resource predicate (false while loading = fail-closed). */
  canAccess: (id: string) => boolean;
  /** Ids to keep regardless of access (e.g. an already-selected value). */
  keepIds?: Iterable<string>;
}): T[] {
  if (allowAll) return [...items];
  const keep = keepIds instanceof Set ? keepIds : new Set(keepIds);
  return items.filter((item) => {
    const id = getId(item);
    return canAccess(id) || keep.has(id);
  });
}
