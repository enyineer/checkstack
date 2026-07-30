/** One team's grant on a resource, as the access editor renders it. */
export interface TeamGrant {
  teamId: string;
  canManage: boolean;
}

/**
 * Would revoking `teamId`'s edit grant strand the CALLER?
 *
 * True when the affected team is one of the caller's own, that team currently
 * holds Manage, no OTHER team of theirs also holds Manage, and they hold no
 * global teams-admin rule to undo it with. In that case removing the grant (or
 * downgrading it to read-only) is a one-way door: afterwards they can neither
 * change the resource nor restore the permission, and an administrator has to
 * grant it back.
 *
 * A global `auth.teams.manage` admin can always restore what they removed, so
 * they are never warned. Pure so the branching is unit-testable without React.
 */
export function isSelfRevokingChange({
  teamId,
  grants,
  myTeamIds,
  isGlobalTeamsAdmin,
}: {
  teamId: string;
  grants: readonly TeamGrant[];
  myTeamIds: ReadonlySet<string>;
  isGlobalTeamsAdmin: boolean;
}): boolean {
  if (isGlobalTeamsAdmin) return false;
  if (!myTeamIds.has(teamId)) return false;

  const target = grants.find((g) => g.teamId === teamId);
  if (!target?.canManage) return false;

  // Another team of mine can still manage it - not a lockout.
  return !grants.some(
    (g) => g.canManage && g.teamId !== teamId && myTeamIds.has(g.teamId),
  );
}
