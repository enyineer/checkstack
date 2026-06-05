import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogAddSystemToGroupTool } from "./catalog-add-system-to-group";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.manage", "catalog.group.manage"],
};

function fakeRpcClient({
  addSystemToGroup,
}: {
  addSystemToGroup: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ addSystemToGroup }),
  } as unknown as RpcClient;
}

describe("catalog.addSystemToGroup tool", () => {
  test("declares mutate effect + the system manage rule", () => {
    const tool = createCatalogAddSystemToGroupTool();
    expect(tool.name).toBe("catalog.addSystemToGroup");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the membership and NEVER mutates", async () => {
    const addSystemToGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ addSystemToGroup });
    const tool = createCatalogAddSystemToGroupTool();
    const input = { groupId: "grp1", systemId: "sys1" };
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(addSystemToGroup).not.toHaveBeenCalled();
    expect(preview.summary).toContain("sys1");
    expect(preview.summary).toContain("grp1");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) calls addSystemToGroup with { groupId, systemId }", async () => {
    const addSystemToGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ addSystemToGroup });
    const tool = createCatalogAddSystemToGroupTool();
    const input = { groupId: "grp1", systemId: "sys1" };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(addSystemToGroup).toHaveBeenCalledWith(input);
    expect(result).toEqual({ groupId: "grp1", systemId: "sys1", added: true });
  });
});
