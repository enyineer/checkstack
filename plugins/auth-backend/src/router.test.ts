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
    type: "user" as const,
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
    transaction: mock((cb: any) => cb(mockDb)), // Updated reference to mockDb
  };

  const mockRegistry = {
    getStrategies: () => [
      {
        id: "credential",
        displayName: "Credentials",
        description: "Email and password authentication",
        configSchema: z.object({ enabled: z.boolean() }),
        configVersion: 1,
        migrations: [],
        requiresManualRegistration: true,
      },
    ],
  };

  const mockConfigService: any = {
    get: mock(() => Promise.resolve(undefined)),
    getRedacted: mock(() => Promise.resolve({})),
    set: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    list: mock(() => Promise.resolve([])),
  };

  const mockPermissionRegistry = {
    getPermissions: () => [
      { id: "auth-backend.users.read", description: "List all users" },
      { id: "auth-backend.users.manage", description: "Delete users" },
      { id: "auth-backend.roles.read", description: "Read and list roles" },
    ],
  };

  const router = createAuthRouter(
    mockDb,
    mockRegistry,
    async () => {},
    mockConfigService,
    mockPermissionRegistry
  );

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

  it("deleteUser cascades to delete related records", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const userId = "user-to-delete";

    // Track which tables had delete called on them
    const deletedTables: any[] = [];
    const mockTx: any = {
      delete: mock((table: any) => {
        deletedTables.push(table); // Track table
        return {
          where: mock(() => Promise.resolve()),
        };
      }),
    };

    mockDb.transaction.mockImplementationOnce((cb: any) => cb(mockTx));

    await call(router.deleteUser, userId, { context });

    // Verify transaction was used
    expect(mockDb.transaction).toHaveBeenCalled();

    // Verify all related tables were deleted in order
    expect(deletedTables).toHaveLength(4);
    expect(deletedTables.includes(schema.userRole)).toBe(true);
    expect(deletedTables.includes(schema.session)).toBe(true);
    expect(deletedTables.includes(schema.account)).toBe(true);
    expect(deletedTables.includes(schema.user)).toBe(true);
  });

  it("getRoles returns all roles with permissions", async () => {
    const context = createMockRpcContext({ user: mockUser });
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() => createChain([{ id: "admin", name: "Admin" }])),
    }));
    mockDb.select.mockImplementationOnce(() => ({
      from: mock(() =>
        createChain([{ roleId: "admin", permissionId: "users.manage" }])
      ),
    }));

    const result = await call(router.getRoles, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("admin");
    expect(result[0].permissions).toContain("users.manage");
  });

  it("updateUserRoles updates user roles", async () => {
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.updateUserRoles,
      { userId: "other-user", roles: ["admin"] },
      { context }
    );
    // updateUserRoles returns void, so just check it completed
    expect(result).toBeUndefined();
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
    expect(mockConfigService.set).toHaveBeenCalled();
  });

  it("getRegistrationStatus returns default true", async () => {
    const context = createMockRpcContext({ user: undefined }); // Public endpoint
    const result = await call(router.getRegistrationStatus, undefined, {
      context,
    });
    expect(result.allowRegistration).toBe(true);
  });

  it("setRegistrationStatus updates flag and requires permission", async () => {
    const context = createMockRpcContext({ user: mockUser });
    const result = await call(
      router.setRegistrationStatus,
      { allowRegistration: false },
      { context }
    );
    expect(result.success).toBe(true);
    expect(mockConfigService.set).toHaveBeenCalledWith(
      "platform.registration",
      expect.anything(),
      1,
      { allowRegistration: false }
    );
  });
});
