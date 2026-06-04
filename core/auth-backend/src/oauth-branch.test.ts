import { describe, expect, test } from "bun:test";
import type { RealUser } from "@checkstack/backend-api";
import { narrowedPrincipalFromSession } from "./oauth-branch";

const CATALOG = [
  "incident.incident.read",
  "incident.incident.manage",
  "anomaly.anomaly.read",
];

function liveUser(accessRules: string[]): RealUser {
  return {
    type: "user",
    id: "u1",
    email: "u1@example.com",
    name: "User One",
    roles: ["users"],
    accessRules,
    teamIds: ["team-a", "team-b"],
  };
}

describe("narrowedPrincipalFromSession (§6.3)", () => {
  test("accessRules = granted ∩ liveRules (NOT the full live rules)", () => {
    const principal = narrowedPrincipalFromSession({
      session: {
        userId: "u1",
        scopes: "incident.incident.read incident.incident.manage",
      },
      principal: {
        base: liveUser(["incident.incident.read", "anomaly.anomaly.read"]),
        catalog: CATALOG,
      },
    });
    // manage granted but not held -> dropped; anomaly held but not granted -> absent.
    expect(principal?.accessRules).toEqual(["incident.incident.read"]);
  });

  test("teamIds are inherited verbatim from the live enrichment", () => {
    const principal = narrowedPrincipalFromSession({
      session: { userId: "u1", scopes: "incident.incident.read" },
      principal: {
        base: liveUser(["incident.incident.read"]),
        catalog: CATALOG,
      },
    });
    expect(principal?.teamIds).toEqual(["team-a", "team-b"]);
    expect(principal?.type).toBe("user");
  });

  test("a rule the principal has since LOST is dropped (live narrowing)", () => {
    const principal = narrowedPrincipalFromSession({
      session: { userId: "u1", scopes: "incident.incident.manage" },
      principal: {
        // The live user no longer has manage.
        base: liveUser(["incident.incident.read"]),
        catalog: CATALOG,
      },
    });
    expect(principal?.accessRules).toEqual([]);
  });

  test("a token with no granted scopes is treated as unauthenticated", () => {
    const principal = narrowedPrincipalFromSession({
      session: { userId: "u1", scopes: "" },
      principal: { base: liveUser(["incident.incident.read"]), catalog: CATALOG },
    });
    expect(principal).toBeUndefined();
  });

  test("admin token carries the concrete granted set, never the bare wildcard", () => {
    const principal = narrowedPrincipalFromSession({
      session: { userId: "u1", scopes: "checkstack:write" },
      principal: { base: liveUser(["*"]), catalog: CATALOG },
    });
    expect(principal?.accessRules?.sort()).toEqual([...CATALOG].sort());
    expect(principal?.accessRules).not.toContain("*");
  });
});
