import { describe, expect, test } from "bun:test";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthService, RealUser, ServiceUser } from "@checkstack/backend-api";
import {
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceVisibility,
} from "@checkstack/maintenance-common";
import {
  isVisibleAtAudience,
  filterByAudience,
  scopeEditHistory,
  resolveMaintenanceAudience,
  type ReadAudience,
} from "./read-visibility";

const MANAGE_ID = qualifyAccessRuleId(
  pluginMetadata,
  maintenanceAccess.maintenance.manage,
);

/** Auth stub whose `check` returns a fixed verdict. */
function fakeAuth(hasAccess: boolean): Pick<AuthService, "check"> {
  return {
    check: async () => ({ hasAccess }),
  };
}

describe("isVisibleAtAudience", () => {
  const rows: Array<[MaintenanceVisibility, ReadAudience, boolean]> = [
    ["public", "public", true],
    ["logged_in", "public", false],
    ["internal", "public", false],
    ["public", "authenticated", true],
    ["logged_in", "authenticated", true],
    ["internal", "authenticated", false],
    ["internal", "manager", true],
  ];
  test.each(rows)("%s @ %s => %s", (visibility, audience, expected) => {
    expect(isVisibleAtAudience(visibility, audience)).toBe(expected);
  });
});

describe("filterByAudience", () => {
  const items: Array<{ id: string; visibility: MaintenanceVisibility }> = [
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
      visibility: "public" as MaintenanceVisibility,
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

describe("resolveMaintenanceAudience", () => {
  test("no user => public", async () => {
    expect(
      await resolveMaintenanceAudience({
        context: { user: undefined, auth: fakeAuth(false) },
        maintenanceId: "m1",
      }),
    ).toBe("public");
  });

  test("service user => manager (trusted)", async () => {
    const user: ServiceUser = { type: "service", pluginId: "other" };
    expect(
      await resolveMaintenanceAudience({
        context: { user, auth: fakeAuth(false) },
        maintenanceId: "m1",
      }),
    ).toBe("manager");
  });

  test("global manage rule => manager", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [MANAGE_ID] };
    expect(
      await resolveMaintenanceAudience({
        context: { user, auth: fakeAuth(false) },
        maintenanceId: "m1",
      }),
    ).toBe("manager");
  });

  test("team grant on this maintenance => manager", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [] };
    expect(
      await resolveMaintenanceAudience({
        context: { user, auth: fakeAuth(true) },
        maintenanceId: "m1",
      }),
    ).toBe("manager");
  });

  test("authenticated non-manager => authenticated", async () => {
    const user: RealUser = { type: "user", id: "u1", accessRules: [] };
    expect(
      await resolveMaintenanceAudience({
        context: { user, auth: fakeAuth(false) },
        maintenanceId: "m1",
      }),
    ).toBe("authenticated");
  });
});
