import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogRemoveSystemFromGroupTool } from "./catalog-remove-system-from-group";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.manage", "catalog.group.manage"],
};

function fakeRpcClient({
  removeSystemFromGroup,
}: {
  removeSystemFromGroup: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ removeSystemFromGroup }),
  } as unknown as RpcClient;
}

describe("catalog.removeSystemFromGroup tool", () => {
  test("declares mutate effect (reversible unassignment) + the system manage rule", () => {
    const tool = createCatalogRemoveSystemFromGroupTool();
    expect(tool.name).toBe("catalog.removeSystemFromGroup");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the unassignment and NEVER mutates", async () => {
    const removeSystemFromGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ removeSystemFromGroup });
    const tool = createCatalogRemoveSystemFromGroupTool();
    const input = { groupId: "grp1", systemId: "sys1" };
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(removeSystemFromGroup).not.toHaveBeenCalled();
    expect(preview.summary).toContain("sys1");
    expect(preview.summary).toContain("grp1");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) calls removeSystemFromGroup with { groupId, systemId }", async () => {
    const removeSystemFromGroup = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ removeSystemFromGroup });
    const tool = createCatalogRemoveSystemFromGroupTool();
    const input = { groupId: "grp1", systemId: "sys1" };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(removeSystemFromGroup).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      groupId: "grp1",
      systemId: "sys1",
      removed: true,
    });
  });
});
