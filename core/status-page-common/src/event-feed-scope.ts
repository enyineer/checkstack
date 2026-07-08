/**
 * Pure scope resolution for the event-feed widgets (incidents, maintenance).
 *
 * The stored config carries `systemIds` (explicit picks), `groupIds` (catalog
 * groups to expand), and `excludedSystemIds` (systems removed from the resolved
 * scope). The effective scope is computed at RESOLVE TIME as
 * `(systemIds ∪ members(groupIds)) − excludedSystemIds`, so a system added to a
 * group AFTER the page was configured is reflected automatically.
 *
 * Group membership is supplied by the caller (fetched from the catalog with the
 * trusted client) so this stays pure and unit-testable.
 */

export interface ResolveEventFeedScopeArgs {
  systemIds: string[];
  groupIds: string[];
  excludedSystemIds: string[];
  /** Current membership per group id -> its system ids. */
  groupMembers: Map<string, string[]>;
}

export function resolveEventFeedScope({
  systemIds,
  groupIds,
  excludedSystemIds,
  groupMembers,
}: ResolveEventFeedScopeArgs): Set<string> {
  const scope = new Set<string>(systemIds);
  for (const groupId of groupIds) {
    for (const memberId of groupMembers.get(groupId) ?? []) {
      scope.add(memberId);
    }
  }
  for (const excluded of excludedSystemIds) {
    scope.delete(excluded);
  }
  return scope;
}
