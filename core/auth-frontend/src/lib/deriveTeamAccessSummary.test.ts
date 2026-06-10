import { describe, it, expect } from "bun:test";
import { deriveTeamAccessSummary } from "./deriveTeamAccessSummary";

describe("deriveTeamAccessSummary", () => {
  it("is 'open' with no grants", () => {
    expect(
      deriveTeamAccessSummary({ accessList: [], teamOnly: false }),
    ).toEqual({ kind: "open" });
    // teamOnly is irrelevant with no grants.
    expect(deriveTeamAccessSummary({ accessList: [], teamOnly: true })).toEqual(
      { kind: "open" },
    );
  });

  it("is 'managed' listing only the teams that can manage", () => {
    expect(
      deriveTeamAccessSummary({
        accessList: [
          { teamName: "SRE", canManage: true },
          { teamName: "Viewers", canManage: false },
          { teamName: "Platform", canManage: true },
        ],
        teamOnly: false,
      }),
    ).toEqual({ kind: "managed", managingTeams: ["SRE", "Platform"] });
  });

  it("is 'readonly-grants' when grants exist but none can manage", () => {
    expect(
      deriveTeamAccessSummary({
        accessList: [{ teamName: "Viewers", canManage: false }],
        teamOnly: false,
      }),
    ).toEqual({ kind: "readonly-grants" });
  });

  it("is 'private' (listing all granted teams) when teamOnly", () => {
    expect(
      deriveTeamAccessSummary({
        accessList: [
          { teamName: "SRE", canManage: true },
          { teamName: "Viewers", canManage: false },
        ],
        teamOnly: true,
      }),
    ).toEqual({ kind: "private", teams: ["SRE", "Viewers"] });
  });
});
