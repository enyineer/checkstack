import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogUpdateGroupTool } from "./catalog-update-group";

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
  updateGroup,
}: {
  getGroups: ReturnType<typeof mock>;
  updateGroup: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getGroups, updateGroup }),
  } as unknown as RpcClient;
}

describe("catalog.updateGroup tool", () => {
  test("declares mutate effect + the group manage rule", () => {
    const tool = createCatalogUpdateGroupTool();
    expect(tool.name).toBe("catalog.updateGroup");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.group.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target via getGroups + returns a diff", async () => {
    const getGroups = mock(() => Promise.resolve([group]));
    const updateGroup = mock(() => Promise.resolve(group));
    const rpcClient = fakeRpcClient({ getGroups, updateGroup });
    const tool = createCatalogUpdateGroupTool();
    const preview = await tool.dryRun!({
      input: { id: "grp1", data: { name: "Billing" } },
      principal,
      rpcClient,
    });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Payments");
    expect(preview.diff).toEqual([
      { path: "name", before: "Payments", after: "Billing" },
    ]);
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getGroups: mock(() => Promise.resolve([group])),
      updateGroup: mock(),
    });
    const tool = createCatalogUpdateGroupTool();
    await expect(
      tool.dryRun!({
        input: { id: "nope", data: { name: "x" } },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/No group found/);
  });

  test("execute (apply) updates via updateGroup", async () => {
    const updateGroup = mock(() => Promise.resolve(group));
    const rpcClient = fakeRpcClient({
      getGroups: mock(() => Promise.resolve([group])),
      updateGroup,
    });
    const tool = createCatalogUpdateGroupTool();
    const input = { id: "grp1", data: { name: "Billing" } };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(updateGroup).toHaveBeenCalledWith(input);
    expect(result).toEqual({ group });
  });
});
