import { describe, expect, test } from "bun:test";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthService, RealUser, ServiceUser } from "@checkstack/backend-api";
import {
  incidentAccess,
  pluginMetadata,
  type IncidentVisibility,
} from "@checkstack/incident-common";
import {
  isVisibleAtAudience,
  filterByAudience,
  scopeEditHistory,
  resolveIncidentAudience,
  type ReadAudience,
} from "./read-visibility";

const MANAGE_ID = qualifyAccessRuleId(
  pluginMetadata,
  incidentAccess.incident.manage,
);

/** Auth stub whose `check` returns a fixed verdict and records its calls. */
function fakeAuth(hasAccess: boolean): Pick<AuthService, "check"> {
  return {
    check: async () => ({ hasAccess }),
  };
}

describe("isVisibleAtAudience", () => {
  const rows: Array<[IncidentVisibility, ReadAudience, boolean]> = [
    ["public", "public", true],
    ["logged_in", "public", false],
    ["internal", "public", false],
    ["public", "authenticated", true],
    ["logged_in", "authenticated", true],
    ["internal", "authenticated", false],
    ["public", "manager", true],
    ["logged_in", "manager", true],
    ["internal", "manager", true],
  ];
  test.each(rows)("%s @ %s => %s", (visibility, audience, expected) => {
    expect(isVisibleAtAudience(visibility, audience)).toBe(expected);
  });
});

describe("filterByAudience", () => {
  const items: Array<{ id: string; visibility: IncidentVisibility }> = [
    { id: "p", visibility: "public" },
    { id: "l", visibility: "logged_in" },
    { id: "i", visibility: "internal" },
  ];

  test("anonymous sees only public", () => {
    expect(filterByAudience(items, "public").map((i) => i.id)).toEqual(["p"]);
  });
  test("authenticated excludes internal", () => {
    expect(filterByAudience(items, "authenticated").map((i) => i.id)).toEqual([
      "p",
      "l",
    ]);
  });
  test("manager sees all", () => {
    expect(filterByAudience(items, "manager").map((i) => i.id)).toEqual([
      "p",
      "l",
      "i",
    ]);
  });
});

describe("scopeEditHistory", () => {
  // A now-public update whose PRIOR version was internal: exposing the history
  // to a non-manager would leak the prior internal content.
  const updates = [
    {
      id: "u1",
      visibility: "public" as IncidentVisibility,
      editHistory: [
        {
          message: "secret internal note",
          visibility: "internal",
          createdAt: "2026-01-01T00:00:00.000Z",
          editedAt: "2026-01-01T01:00:00.000Z",
        },
      ],
    },
  ];

  test("manager keeps the edit history", () => {
    const [u] = scopeEditHistory(updates, "manager");
    expect(u.editHistory).toHaveLength(1);
  });

  test("authenticated non-manager gets history stripped", () => {
    const [u] = scopeEditHistory(updates, "authenticated");
    expect(u.editHistory).toBeUndefined();
  });

  test("public reader gets history stripped (no prior internal leak)", () => {
    const [u] = scopeEditHistory(updates, "public");
    expect(u.editHistory).toBeUndefined();
  });
});

describe("resolveIncidentAudience", () => {
  test("no user => public", async () => {
    const audience = await resolveIncidentAudience({
      context: { user: undefined, auth: fakeAuth(false) },
      incidentId: "inc1",
    });
    expect(audience).toBe("public");
  });

  test("service user => manager (trusted)", async () => {
    const user: ServiceUser = { type: "service", pluginId: "other" };
    const audience = await resolveIncidentAudience({
      context: { user, auth: fakeAuth(false) },
      incidentId: "inc1",
    });
    expect(audience).toBe("manager");
  });

  test("global manage rule => manager", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [MANAGE_ID] };
    const audience = await resolveIncidentAudience({
      context: { user, auth: fakeAuth(false) },
      incidentId: "inc1",
    });
    expect(audience).toBe("manager");
  });

  test("wildcard rule => manager", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: ["*"] };
    const audience = await resolveIncidentAudience({
      context: { user, auth: fakeAuth(false) },
      incidentId: "inc1",
    });
    expect(audience).toBe("manager");
  });

  test("team grant on this incident => manager", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [] };
    const audience = await resolveIncidentAudience({
      context: { user, auth: fakeAuth(true) },
      incidentId: "inc1",
    });
    expect(audience).toBe("manager");
  });

  test("authenticated non-manager => authenticated", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [] };
    const audience = await resolveIncidentAudience({
      context: { user, auth: fakeAuth(false) },
      incidentId: "inc1",
    });
    expect(audience).toBe("authenticated");
  });
});
