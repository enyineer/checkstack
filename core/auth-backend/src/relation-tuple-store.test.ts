import { describe, it, expect } from "bun:test";
import { evaluateAccess, type ObjectTuple } from "./relation-tuple-store";

/**
 * Security-critical decision logic. These cases pin the EXACT behaviour the old
 * `checkResourceTeamAccess` (teamOnly model) had, now over relation tuples:
 *   - not private + no grants    -> default-open (global RBAC verdict)
 *   - not private + grants        -> global path open (global verdict wins)
 *   - PRIVATE (marker present)    -> team grants only; NO grants -> deny everyone
 * with implication owner ⊃ editor ⊃ viewer.
 */
const team = (subjectId: string, relation: string): ObjectTuple => ({
  relation,
  subjectType: "team",
  subjectId,
});
// The privacy marker: present => global path closed for the object.
const PRIVATE: ObjectTuple = {
  relation: "private",
  subjectType: "public",
  subjectId: "*",
};

describe("evaluateAccess", () => {
  describe("not private + no team grants → default-open (global RBAC governs)", () => {
    it("allows when caller has global access", () => {
      expect(
        evaluateAccess({ tuples: [], userTeamIds: [], action: "read", hasGlobalAccess: true }),
      ).toBe(true);
    });
    it("denies when caller lacks global access", () => {
      expect(
        evaluateAccess({ tuples: [], userTeamIds: ["t1"], action: "read", hasGlobalAccess: false }),
      ).toBe(false);
    });
  });

  describe("not private + team grants (globally readable + team-managed)", () => {
    const tuples = [team("payments", "editor")];
    it("global-access holder may read", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: [], action: "read", hasGlobalAccess: true }),
      ).toBe(true);
    });
    it("global-access holder may manage", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: [], action: "manage", hasGlobalAccess: true }),
      ).toBe(true);
    });
    it("non-global outsider cannot read", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: ["other"], action: "read", hasGlobalAccess: false }),
      ).toBe(false);
    });
    it("member of the granted team may manage", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: ["payments"], action: "manage", hasGlobalAccess: false }),
      ).toBe(true);
    });
  });

  describe("PRIVATE (marker present): global path closed, team grants only", () => {
    const tuples = [team("payments", "editor"), PRIVATE];
    it("global-access holder is DENIED read (private opts out of the global path)", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: [], action: "read", hasGlobalAccess: true }),
      ).toBe(false);
    });
    it("granted team member may read and manage", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: ["payments"], action: "read", hasGlobalAccess: true }),
      ).toBe(true);
      expect(
        evaluateAccess({ tuples, userTeamIds: ["payments"], action: "manage", hasGlobalAccess: false }),
      ).toBe(true);
    });
    it("a different team is denied", () => {
      expect(
        evaluateAccess({ tuples, userTeamIds: ["other"], action: "read", hasGlobalAccess: false }),
      ).toBe(false);
    });
    // S1 regression: a PRIVATE object with ZERO team grants must deny everyone,
    // including a global-rule holder (the old teamOnly fail-closed invariant).
    it("private with NO team grants denies a global-access holder", () => {
      expect(
        evaluateAccess({ tuples: [PRIVATE], userTeamIds: [], action: "read", hasGlobalAccess: true }),
      ).toBe(false);
    });
    it("private with NO team grants denies a member of an unrelated team", () => {
      expect(
        evaluateAccess({ tuples: [PRIVATE], userTeamIds: ["x"], action: "read", hasGlobalAccess: true }),
      ).toBe(false);
    });
  });

  describe("relation implication owner ⊃ editor ⊃ viewer", () => {
    it("viewer can read but NOT manage", () => {
      const tuples = [team("t", "viewer")];
      expect(
        evaluateAccess({ tuples, userTeamIds: ["t"], action: "read", hasGlobalAccess: false }),
      ).toBe(true);
      expect(
        evaluateAccess({ tuples, userTeamIds: ["t"], action: "manage", hasGlobalAccess: false }),
      ).toBe(false);
    });
    it("editor can manage", () => {
      const tuples = [team("t", "editor")];
      expect(
        evaluateAccess({ tuples, userTeamIds: ["t"], action: "manage", hasGlobalAccess: false }),
      ).toBe(true);
    });
    it("owner can manage", () => {
      const tuples = [team("t", "owner")];
      expect(
        evaluateAccess({ tuples, userTeamIds: ["t"], action: "manage", hasGlobalAccess: false }),
      ).toBe(true);
    });
  });

  it("ignores creator tuples for object access (creator is type-level only)", () => {
    // A stray creator relation must not grant read/manage on a concrete object.
    const tuples = [team("t", "creator")];
    expect(
      evaluateAccess({ tuples, userTeamIds: ["t"], action: "read", hasGlobalAccess: false }),
    ).toBe(false);
  });
});
