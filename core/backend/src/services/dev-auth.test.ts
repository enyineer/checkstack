import { describe, it, expect } from "bun:test";
import { createDevAuthService } from "./dev-auth";

describe("createDevAuthService", () => {
  it("authenticate() returns a stable RealUser identity", async () => {
    const svc = createDevAuthService({ getAllAccessRules: () => [] });
    const user = await svc.authenticate(new Request("http://x"));
    expect(user).toBeDefined();
    if (!user || user.type !== "user") {
      throw new Error("expected RealUser");
    }
    expect(user.id).toBe("dev-user");
    expect(user.email).toBe("dev@checkstack.local");
    expect(user.name).toBe("Dev User");
    expect(user.roles).toEqual(["admin"]);
    expect(user.teamIds).toEqual([]);
  });

  it("populates accessRules from the registered set", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [
        { id: "catalog.system.read" },
        { id: "catalog.system.manage" },
      ],
    });
    const user = await svc.authenticate(new Request("http://x"));
    if (!user || user.type !== "user") throw new Error("expected RealUser");
    expect(user.accessRules).toEqual([
      "catalog.system.read",
      "catalog.system.manage",
    ]);
  });

  it("re-reads access rules on each authenticate (rules registered later still apply)", async () => {
    const rules = [{ id: "first.rule" }];
    const svc = createDevAuthService({ getAllAccessRules: () => rules });

    const before = await svc.authenticate(new Request("http://x"));
    if (!before || before.type !== "user") throw new Error("expected RealUser");
    expect(before.accessRules).toEqual(["first.rule"]);

    rules.push({ id: "second.rule" });
    const after = await svc.authenticate(new Request("http://x"));
    if (!after || after.type !== "user") throw new Error("expected RealUser");
    expect(after.accessRules).toEqual(["first.rule", "second.rule"]);
  });

  it("getAnonymousAccessRules returns an empty list (anonymous gets nothing in dev)", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [{ id: "x" }, { id: "y" }],
    });
    expect(await svc.getAnonymousAccessRules()).toEqual([]);
  });

  it("getCredentials returns an empty headers object", async () => {
    const svc = createDevAuthService({ getAllAccessRules: () => [] });
    expect(await svc.getCredentials()).toEqual({ headers: {} });
  });

  it("checkResourceTeamAccess always grants", async () => {
    const svc = createDevAuthService({ getAllAccessRules: () => [] });
    expect(
      await svc.checkResourceTeamAccess({
        userId: "x",
        userType: "user",
        resourceType: "system",
        resourceId: "abc",
        action: "manage",
        hasGlobalAccess: false,
      }),
    ).toEqual({ hasAccess: true });
  });

  it("getAccessibleResourceIds returns the input list unfiltered", async () => {
    const svc = createDevAuthService({ getAllAccessRules: () => [] });
    expect(
      await svc.getAccessibleResourceIds({
        userId: "x",
        userType: "user",
        resourceType: "system",
        resourceIds: ["one", "two", "three"],
        action: "read",
        hasGlobalAccess: false,
      }),
    ).toEqual(["one", "two", "three"]);
  });
});
