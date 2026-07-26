import { describe, it, expect } from "bun:test";
import { isSelfRevokingChange, type TeamGrant } from "./selfLockout";

/**
 * Guards the self-lockout warning on the "Who can change this" editor: a
 * team-scoped user could silently revoke their OWN team's only edit grant and
 * afterwards be unable to change the resource OR restore the permission.
 */
const mine = new Set(["team-mine"]);

const grants = (...g: TeamGrant[]): TeamGrant[] => g;

describe("isSelfRevokingChange", () => {
  it("warns when revoking my own team's ONLY edit grant", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants({ teamId: "team-mine", canManage: true }),
        myTeamIds: mine,
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(true);
  });

  it("does NOT warn a global teams admin - they can always restore it", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants({ teamId: "team-mine", canManage: true }),
        myTeamIds: mine,
        isGlobalTeamsAdmin: true,
      }),
    ).toBe(false);
  });

  it("does NOT warn when the team is not one of mine", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-other",
        grants: grants({ teamId: "team-other", canManage: true }),
        myTeamIds: mine,
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(false);
  });

  it("does NOT warn when ANOTHER team of mine still has edit access", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants(
          { teamId: "team-mine", canManage: true },
          { teamId: "team-mine-2", canManage: true },
        ),
        myTeamIds: new Set(["team-mine", "team-mine-2"]),
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(false);
  });

  it("does NOT warn when another team of mine is only READ-ONLY (still a lockout)", () => {
    // A viewer grant cannot restore anything, so this IS still a lockout.
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants(
          { teamId: "team-mine", canManage: true },
          { teamId: "team-mine-2", canManage: false },
        ),
        myTeamIds: new Set(["team-mine", "team-mine-2"]),
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(true);
  });

  it("does NOT warn when my team is already read-only (nothing to lose)", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants({ teamId: "team-mine", canManage: false }),
        myTeamIds: mine,
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(false);
  });

  it("ignores OTHER teams' manage grants - they don't help me", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: grants(
          { teamId: "team-mine", canManage: true },
          { teamId: "team-other", canManage: true },
        ),
        myTeamIds: mine,
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(true);
  });

  it("does not warn for a team absent from the grant list", () => {
    expect(
      isSelfRevokingChange({
        teamId: "team-mine",
        grants: [],
        myTeamIds: mine,
        isGlobalTeamsAdmin: false,
      }),
    ).toBe(false);
  });
});
