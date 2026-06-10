import { describe, it, expect, mock } from "bun:test";
import { createCatalogRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import type { CatalogCache } from "./cache";

const passthroughCache: CatalogCache = {
  wrapEntities: (loader) => loader(),
  wrapSystems: (loader) => loader(),
  wrapGroups: (loader) => loader(),
  wrapSystem: (_systemId, loader) => loader(),
  wrapGroupsForSystem: (_systemId, loader) => loader(),
  wrapViews: (loader) => loader(),
  wrapContacts: (_systemId, loader) => loader(),
  wrapLinks: (_systemId, loader) => loader(),
  invalidateTopology: async () => 0,
  invalidateViews: async () => 0,
  invalidateContacts: async () => {},
  invalidateLinks: async () => {},
  scope: {} as CatalogCache["scope"],
};

describe("Catalog Router - GitOps Provenance Enforcement", () => {
  const mockUser = {
    type: "user" as const,
    id: "test-user",
    accessRules: ["*"],
    roles: ["admin"],
  };

  const mockDb = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    })),
  } as unknown;

  const mockNotificationClient = {
    createGroup: mock(() => Promise.resolve()),
    deleteGroup: mock(() => Promise.resolve()),
    notifyGroups: mock(() => Promise.resolve({ notifiedCount: 0 })),
  };

  const mockAuthClient = {
    getUserById: mock(() => Promise.resolve(null)),
  };

  const mockGitOpsClient = {
    getProvenance: mock<any>(() => Promise.resolve(null)),
  };

  const router = createCatalogRouter({
    database: mockDb as never,
    notificationClient: mockNotificationClient as never,
    authClient: mockAuthClient as never,
    gitOpsClient: mockGitOpsClient as never,
    pluginId: "test-catalog",
    cache: passthroughCache,
  });

  it("allows deleteSystem when GitOps lock is not present", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
    const context = createMockRpcContext({ user: mockUser, emitHook: mock(() => Promise.resolve()) });

    try {
      await call(router.deleteSystem, { id: "sys-1" }, { context });
    } catch (e: any) {
      expect(e.code).not.toBe("FORBIDDEN");
    }

    expect(mockGitOpsClient.getProvenance).toHaveBeenCalledWith({
      kind: "System",
      entityId: "sys-1",
    });
  });

  it("throws FORBIDDEN when deleting a GitOps locked system", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce({
      id: "prov-1", kind: "System", entityId: "sys-1",
      providerId: "prov", entityName: "sys1", status: "synced",
      lastSyncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      repository: "", filePath: "", fileSha: ""
    });
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(router.deleteSystem, { id: "sys-1" }, { context });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("FORBIDDEN");
    expect((error as any).message).toContain("managed by GitOps");
  });

  it("throws FORBIDDEN when updating a GitOps locked group", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce({
      id: "prov-1", kind: "Group", entityId: "grp-1",
      providerId: "prov", entityName: "grp1", status: "synced",
      lastSyncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      repository: "", filePath: "", fileSha: ""
    });
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(router.updateGroup, { id: "grp-1", data: { name: "New Name" } }, { context });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when adding a locked system to a group", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce({
      id: "prov-1", kind: "System", entityId: "sys-1",
      providerId: "prov", entityName: "sys1", status: "synced",
      lastSyncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      repository: "", filePath: "", fileSha: ""
    }); 
    
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(router.addSystemToGroup, { systemId: "sys-1", groupId: "grp-1" }, { context });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("FORBIDDEN");
  });

  it("throws CONFLICT when creating a system whose name already exists", async () => {
    // getSystemByName (the first/only select before the guard throws) finds a
    // system already using this name.
    (mockDb as { select: ReturnType<typeof mock> }).select.mockReturnValueOnce({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "existing",
              name: "Payments",
              description: null,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
      }),
    });
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(router.createSystem, { name: "Payments" }, { context });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("CONFLICT");
    expect((error as any).message).toContain("already exists");
  });

  it("throws CONFLICT when renaming a system to a name another system uses", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
    // 1st select: getSystem(id) finds the system being renamed.
    // 2nd select: getSystemByName(newName) finds a DIFFERENT system.
    (mockDb as { select: ReturnType<typeof mock> }).select
      .mockReturnValueOnce({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: "sys-1",
                name: "Old",
                description: null,
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: "other",
                name: "Taken",
                description: null,
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
        }),
      });
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(
        router.updateSystem,
        { id: "sys-1", data: { name: "Taken" } },
        { context },
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("CONFLICT");
    expect((error as any).message).toContain("already exists");
  });

  it("allows adding an unlocked system to a group, even if the group is locked", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
    
    const context = createMockRpcContext({ user: mockUser });

    try {
      await call(router.addSystemToGroup, { systemId: "sys-1", groupId: "grp-1" }, { context });
    } catch (e: any) {
      expect(e.code).not.toBe("FORBIDDEN");
    }
  });

  it("maps a DB unique violation (concurrent create race) to CONFLICT", async () => {
    // The pre-insert name check finds no clash...
    (mockDb as { select: ReturnType<typeof mock> }).select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
    // ...but the INSERT loses a race and the DB's unique index rejects it.
    (mockDb as { insert: ReturnType<typeof mock> }).insert = mock(() => ({
      values: () => ({
        returning: () => Promise.reject({ code: "23505" }),
      }),
    }));
    const context = createMockRpcContext({ user: mockUser });

    let error;
    try {
      await call(router.createSystem, { name: "Payments" }, { context });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as any).code).toBe("CONFLICT");
    expect((error as any).message).toContain("already exists");
  });
});
