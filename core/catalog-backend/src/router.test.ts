import { describe, it, expect, mock } from "bun:test";
import { createCatalogRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";

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
  });

  it("allows deleteSystem when GitOps lock is not present", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
    const context = createMockRpcContext({ user: mockUser, emitHook: mock(() => Promise.resolve()) });

    try {
      await call(router.deleteSystem, "sys-1", { context });
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
      await call(router.deleteSystem, "sys-1", { context });
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

  it("allows adding an unlocked system to a group, even if the group is locked", async () => {
    mockGitOpsClient.getProvenance.mockResolvedValueOnce(null);
    
    const context = createMockRpcContext({ user: mockUser });

    try {
      await call(router.addSystemToGroup, { systemId: "sys-1", groupId: "grp-1" }, { context });
    } catch (e: any) {
      expect(e.code).not.toBe("FORBIDDEN");
    }
  });
});
