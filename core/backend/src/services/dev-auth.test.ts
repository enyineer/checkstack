import { describe, it, expect, mock } from "bun:test";

// dev-auth signs/verifies S2S tokens via jwtService, which is backed by the
// DB-bound KeyStore. Mock it so these stay pure unit tests (no DB): tokens are
// modeled as `svc:<pluginId>` strings so we can assert the wiring without real
// crypto.
mock.module("./jwt", () => ({
  jwtService: {
    sign: async (payload: Record<string, unknown>) =>
      `svc:${String(payload.service)}`,
    verify: async (token: string) =>
      token.startsWith("svc:") ? { service: token.slice(4) } : undefined,
  },
}));

const { createDevAuthService } = await import("./dev-auth");

describe("createDevAuthService", () => {
  it("authenticate() returns a stable RealUser identity", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [],
      pluginId: "dev",
    });
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
      pluginId: "dev",
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
    const svc = createDevAuthService({
      getAllAccessRules: () => rules,
      pluginId: "dev",
    });

    const before = await svc.authenticate(new Request("http://x"));
    if (!before || before.type !== "user") throw new Error("expected RealUser");
    expect(before.accessRules).toEqual(["first.rule"]);

    rules.push({ id: "second.rule" });
    const after = await svc.authenticate(new Request("http://x"));
    if (!after || after.type !== "user") throw new Error("expected RealUser");
    expect(after.accessRules).toEqual(["first.rule", "second.rule"]);
  });

  it("authenticate() honors real SERVICE tokens (S2S calls stay services, not the dev user)", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [],
      pluginId: "dev",
    });
    // A backend-to-backend caller presents a token minted as `{ service: <id> }`.
    const principal = await svc.authenticate(
      new Request("http://x", {
        headers: { Authorization: "Bearer svc:incident" },
      }),
    );
    expect(principal).toEqual({ type: "service", pluginId: "incident" });
  });

  it("authenticate() falls back to the dev user for non-service tokens", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [{ id: "x" }],
      pluginId: "dev",
    });
    const principal = await svc.authenticate(
      new Request("http://x", {
        headers: { Authorization: "Bearer not-a-real-token" },
      }),
    );
    if (!principal || principal.type !== "user") {
      throw new Error("expected RealUser");
    }
    expect(principal.id).toBe("dev-user");
  });

  it("getAnonymousAccessRules returns an empty list (anonymous gets nothing in dev)", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [{ id: "x" }, { id: "y" }],
      pluginId: "dev",
    });
    expect(await svc.getAnonymousAccessRules()).toEqual([]);
  });

  it("getCredentials mints a service token scoped to this plugin", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [],
      pluginId: "notification",
    });
    const creds = await svc.getCredentials();
    expect(creds.headers.Authorization).toBe("Bearer svc:notification");
  });

  it("checkResourceTeamAccess always grants", async () => {
    const svc = createDevAuthService({
      getAllAccessRules: () => [],
      pluginId: "dev",
    });
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
    const svc = createDevAuthService({
      getAllAccessRules: () => [],
      pluginId: "dev",
    });
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
