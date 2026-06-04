import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogDeleteGroupTool } from "./catalog-delete-group";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.manage", "catalog.group.manage"],
};

const group = {
  id: "grp1",
  name: "Payments",
  systemIds: [],
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient({
  getGroups,
  deleteGroup,
}: {
  getGroups: ReturnType<typeof mock>;
  deleteGroup: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getGroups, deleteGroup }),
  } as unknown as RpcClient;
}

describe("catalog.deleteGroup tool", () => {
  test("declares destructive effect + the group manage rule", () => {
    const tool = createCatalogDeleteGroupTool();
    expect(tool.name).toBe("catalog.deleteGroup");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["catalog.group.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const getGroups = mock(() => Promise.resolve([group]));
    const deleteGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ getGroups, deleteGroup });
    const tool = createCatalogDeleteGroupTool();
    const preview = await tool.dryRun!({
      input: { id: "grp1" },
      principal,
      rpcClient,
    });
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Payments");
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "grp1" });
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getGroups: mock(() => Promise.resolve([group])),
      deleteGroup: mock(),
    });
    const tool = createCatalogDeleteGroupTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No group found/);
  });

  test("execute (apply) deletes via deleteGroup with the POSITIONAL id", async () => {
    const deleteGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({
      getGroups: mock(() => Promise.resolve([group])),
      deleteGroup,
    });
    const tool = createCatalogDeleteGroupTool();
    const result = await tool.execute({
      input: { id: "grp1" },
      principal,
      rpcClient,
    });
    expect(deleteGroup).toHaveBeenCalledWith("grp1");
    expect(result).toEqual({ id: "grp1", deleted: true });
  });
});
