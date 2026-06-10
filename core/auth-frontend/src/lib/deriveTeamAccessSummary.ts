/**
 * The effective team-access state of a resource, derived from its grants +
 * teamOnly flag. Shared by the edit-mode `TeamAccessEditor` status line and the
 * read-only `ResourceManagedBy` indicator so both compute identical semantics
 * from the same data (single source of truth — no second endpoint, no drift).
 */
export type TeamAccessSummary =
  | { kind: "open" } // no grants — globally readable, global-manage to change
  | { kind: "managed"; managingTeams: string[] } // grants, not private, has managers
  | { kind: "readonly-grants" } // grants, not private, but none can manage
  | { kind: "private"; teams: string[] }; // teamOnly — only listed teams

export interface DeriveTeamAccessSummaryInput {
  accessList: Array<{ teamName: string; canManage: boolean }>;
  teamOnly: boolean;
}

export function deriveTeamAccessSummary({
  accessList,
  teamOnly,
}: DeriveTeamAccessSummaryInput): TeamAccessSummary {
  if (accessList.length === 0) return { kind: "open" };
  if (teamOnly) {
    return { kind: "private", teams: accessList.map((a) => a.teamName) };
  }
  const managingTeams = accessList
    .filter((a) => a.canManage)
    .map((a) => a.teamName);
  return managingTeams.length > 0
    ? { kind: "managed", managingTeams }
    : { kind: "readonly-grants" };
}
