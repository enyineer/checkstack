import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import authPlugin from "./index";
import * as schema from "./schema";

// Mock better-auth
const mockAuth = {
  handler: mock(),
  api: {
    getSession: mock(),
  },
};
const mockBetterAuth = mock(() => mockAuth);

mock.module("better-auth", () => ({
  betterAuth: mockBetterAuth,
}));

mock.module("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: mock(),
}));

mock.module("better-auth/crypto", () => ({
  hashPassword: mock(() => Promise.resolve("hashed")),
}));

mock.module("./utils/user", () => ({
  enrichUser: mock((user) =>
    Promise.resolve({ ...user, permissions: ["users.read"] })
  ),
}));

describe("Auth Backend Plugin", () => {
  let router: Hono;
  let db: any;
  let initFn: any;

  const createChain = (data: any = []) => {
    const chain: any = {
      where: mock(() => chain),
      limit: mock(() => chain),
      offset: mock(() => chain),
      orderBy: mock(() => chain),
      onConflictDoUpdate: mock(() => Promise.resolve()),
      then: (resolve: any) => Promise.resolve(resolve(data)),
    };
    return chain;
  };

  beforeEach(async () => {
    router = new Hono();
    db = {
      select: mock(() => ({
        from: mock((table: any) => {
          if (table === schema.user)
            return createChain([
              { id: "1", email: "user1@test.com", name: "User 1" },
            ]);
          if (table === schema.userRole)
            return createChain([{ userId: "1", roleId: "admin" }]);
          if (table === schema.role)
            return createChain([{ id: "admin", name: "Admin" }]);
          if (table === schema.authStrategy)
            return createChain([{ id: "credential", enabled: true }]);
          return createChain([]);
        }),
      })),
      insert: mock(() => ({
        values: mock(() => createChain()),
      })),
      delete: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
      transaction: mock((cb: any) => cb(db)),
    };

    const env = {
      registerPermissions: mock(),
      registerExtensionPoint: mock(),
      registerService: mock(),
      registerInit: mock(({ init }) => {
        initFn = init;
      }),
    };

    authPlugin.register(env as any);

    await initFn({
      database: db,
      router,
      logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
      tokenVerification: { verify: mock(), sign: mock() },
      check: () => async (_c: any, next: any) => await next(),
      validate: () => async (_c: any, next: any) => await next(),
    });
  });

  it("should list users with roles", async () => {
    const res = await router.request("/users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].email).toBe("user1@test.com");
    expect(body[0].roles).toContain("admin");
  });

  it("should return available roles", async () => {
    const res = await router.request("/roles");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("admin");
  });

  it("should not allow updating own roles", async () => {
    mockAuth.api.getSession.mockResolvedValueOnce({
      user: { id: "my-id" },
    });

    const res = await router.request("/users/my-id/roles", {
      method: "POST",
      body: JSON.stringify({ roles: ["admin"] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Cannot update your own roles");
  });

  it("should allow updating roles for other users", async () => {
    mockAuth.api.getSession.mockResolvedValueOnce({
      user: { id: "admin-id" },
    });

    const res = await router.request("/users/other-id/roles", {
      method: "POST",
      body: JSON.stringify({ roles: ["test-role"] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it("should list auth strategies", async () => {
    const res = await router.request("/strategies");
    expect(res.status).toBe(200);
    const body = await res.json();
    // We expect at least 'credential' strategy
    expect(body.some((s: any) => s.id === "credential")).toBe(true);
  });

  it("should toggle auth strategy", async () => {
    const res = await router.request("/strategies/credential", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should prevent deleting initial admin", async () => {
    const res = await router.request("/users/initial-admin-id", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Cannot delete initial admin");
  });

  it("should return user permissions", async () => {
    mockAuth.api.getSession.mockResolvedValueOnce({
      user: { id: "user-id", email: "user@test.com" },
    });

    const res = await router.request("/permissions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("permissions");
    expect(Array.isArray(body.permissions)).toBe(true);
  });
});
