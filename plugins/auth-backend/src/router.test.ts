import { describe, it, expect, mock } from "bun:test";
import { createAuthRouter } from "./router";
import { createMockRpcContext } from "@checkmate/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";
import * as schema from "./schema";

// Mock better-auth
const mockAuth: any = {
  handler: mock(),
  api: {
    getSession: mock(),
  },
};

describe("Auth Router", () => {
  const mockUser = {
    id: "test-user",
    permissions: ["*"],
    roles: ["admin"],
  } as any;

  const createChain = (data: any = []) => {
    const chain: any = {
      where: mock(() => chain),
      innerJoin: mock(() => chain),
      limit: mock(() => chain),
      offset: mock(() => chain),
      orderBy: mock(() => chain),
      onConflictDoUpdate: mock(() => Promise.resolve()),
      then: (resolve: any) => Promise.resolve(resolve(data)),
    };
    return chain;
  };

  const mockDb: any = {
    select: mock(() => ({
      from: mock(() => createChain([])),
    })),
    insert: mock(() => ({
      values: mock(() => createChain()),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
    transaction: mock((cb: any) => cb(mockDb)),
  };

  const router = createAuthRouter(mockAuth, mockDb, []);

  it("getPermissions returns current user permissions", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const result = await call(router.permissions, undefined, { context });
    expect(result.permissions).toContain("*");
  });

  it("getUsers lists users with roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ id: "1", email: "user1@test.com", name: "User 1" }])
      ),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ userId: "1", roleId: "admin" }])),
    }));

    const result = await call(router.getUsers, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].roles).toContain("admin");
  });

  it("deleteUser prevents deleting initial admin", async () => {
    const context = createMockRpcContext({ user: mockUser });
    expect(
      call(router.deleteUser, "initial-admin-id", { context })
    ).rejects.toThrow("Cannot delete initial admin");
  });

  it("getRoles returns all roles", async () => {
    const context = createMockRpcContext({ user: mockUser });
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "admin", name: "Admin" }])),
    }));

    const result = await call(router.getRoles, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("admin");
  });

  it("updateUserRoles updates user roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.updateUserRoles,
      { userId: "other-user", roles: ["admin"] },
      { context }
    );
    expect(result.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("updateUserRoles prevents updating own roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    expect(
      call(
        router.updateUserRoles,
        { userId: "test-user", roles: ["admin"] },
        { context }
      )
    ).rejects.toThrow("Cannot update your own roles");
  });

  it("getStrategies returns available strategies", async () => {
    const context = createMockRpcContext({ user: mockUser });
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "credential", enabled: true }])),
    }));

    const result = await call(router.getStrategies, undefined, { context });
    expect(result.some((s: any) => s.id === "credential")).toBe(true);
  });

  it("updateStrategy updates strategy enabled status", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.updateStrategy,
      { id: "credential", enabled: false },
      { context }
    );
    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
